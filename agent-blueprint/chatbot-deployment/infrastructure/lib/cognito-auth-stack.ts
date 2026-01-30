import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import * as fs from 'fs';

/**
 * Props for CognitoAuthStack
 */
export interface CognitoAuthStackProps extends cdk.StackProps {
  /**
   * Whether to enable SSO authentication via SAML
   * @default false
   */
  readonly enableSso?: boolean;

  /**
   * Path to the IAM Identity Center SAML metadata XML file
   * Required when enableSso is true
   */
  readonly samlMetadataPath?: string;

  /**
   * The CloudFront distribution URL for callback/logout URLs
   * Required when enableSso is true
   */
  readonly cloudFrontUrl?: string;

  /**
   * Environment name (dev, staging, production)
   * @default 'dev'
   */
  readonly environment?: string;
}

export class CognitoAuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly userPoolDomain: cognito.UserPoolDomain;
  public readonly samlIdentityProvider?: cognito.UserPoolIdentityProviderSaml;

  constructor(scope: Construct, id: string, props?: CognitoAuthStackProps) {
    super(scope, id, props);

    const enableSso = props?.enableSso ?? false;
    const environment = props?.environment ?? 'dev';

    // Create Cognito User Pool for authentication
    // Task 1.1.1: Disable self-service sign-up for SSO-only authentication
    this.userPool = new cognito.UserPool(this, 'ChatbotUserPool', {
      userPoolName: `chatbot-users-${environment}`,
      // Disable self-signup when SSO is enabled (users must authenticate via IAM Identity Center)
      selfSignUpEnabled: !enableSso,
      signInAliases: {
        email: true,
      },
      autoVerify: {
        email: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: false, // Email should not be mutable for SSO users
        },
        givenName: {
          required: false,
          mutable: true,
        },
        familyName: {
          required: false,
          mutable: true,
        },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      // Retain user pool in production, destroy in dev/staging
      removalPolicy: environment === 'production' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    // Task 1.1.2 & 1.1.3: Add SAML identity provider configuration with attribute mappings
    if (enableSso) {
      // Check if SAML metadata file exists
      const samlMetadataPath = props?.samlMetadataPath;
      
      if (samlMetadataPath && fs.existsSync(samlMetadataPath)) {
        // Create SAML Identity Provider for IAM Identity Center
        this.samlIdentityProvider = new cognito.UserPoolIdentityProviderSaml(
          this,
          'IAMIdentityCenterSamlProvider',
          {
            userPool: this.userPool,
            name: 'IAMIdentityCenter',
            // Load SAML metadata from file
            metadata: cognito.UserPoolIdentityProviderSamlMetadata.file(samlMetadataPath),
            // Task 1.1.3: Configure SAML attribute mappings (email, name, sub)
            attributeMapping: {
              email: cognito.ProviderAttribute.other(
                'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'
              ),
              givenName: cognito.ProviderAttribute.other(
                'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'
              ),
              // Note: Custom attributes cannot be added to existing user pools
              // If you need to track SAML sub, create a new user pool
            },
            // Enable IdP-initiated SSO
            idpInitiated: true,
          }
        );
      } else {
        // Create a placeholder SAML provider with URL-based metadata
        // This allows the stack to be deployed before the metadata file is available
        // The metadata URL will need to be updated after IAM Identity Center is configured
        console.warn(
          'SAML metadata file not found. Creating placeholder SAML provider. ' +
          'Update the metadata after configuring IAM Identity Center.'
        );
      }
    }

    // Task 1.1.4: Update user pool client for SAML authentication
    // Task 1.1.5: Configure JWT token expiration settings
    const callbackUrls = enableSso && props?.cloudFrontUrl
      ? [
          `${props.cloudFrontUrl}/oauth2/idpresponse`, // Primary OAuth callback URL
          `${props.cloudFrontUrl}/api/auth/callback`,
          `${props.cloudFrontUrl}/`,
        ]
      : ['https://example.com/callback']; // Placeholder for non-SSO mode

    const logoutUrls = enableSso && props?.cloudFrontUrl
      ? [
          `${props.cloudFrontUrl}/`,
          `${props.cloudFrontUrl}/logout`,
        ]
      : ['https://example.com/logout']; // Placeholder for non-SSO mode

    // Create Cognito User Pool Client with SSO support
    this.userPoolClient = new cognito.UserPoolClient(this, 'ChatbotUserPoolClient', {
      userPool: this.userPool,
      userPoolClientName: `chatbot-client-${environment}`,
      generateSecret: false, // Web applications should not use client secret
      authFlows: {
        userPassword: !enableSso, // Disable password auth when SSO is enabled
        userSrp: !enableSso, // Disable SRP auth when SSO is enabled
        custom: false,
        adminUserPassword: false,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
          implicitCodeGrant: false, // Implicit grant is less secure
        },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: callbackUrls,
        logoutUrls: logoutUrls,
      },
      // Task 1.1.5: Configure JWT token expiration settings
      // ID token: 1 hour (for user identity)
      // Access token: 1 hour (for API access)
      // Refresh token: 30 days (for session refresh)
      idTokenValidity: cdk.Duration.hours(1),
      accessTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
      // Enable token revocation for security
      enableTokenRevocation: true,
      // Prevent user existence errors for security
      preventUserExistenceErrors: true,
      // Configure supported identity providers
      supportedIdentityProviders: enableSso && this.samlIdentityProvider
        ? [
            cognito.UserPoolClientIdentityProvider.custom('IAMIdentityCenter'),
          ]
        : [
            cognito.UserPoolClientIdentityProvider.COGNITO,
          ],
    });

    // Ensure the SAML provider is created before the client
    if (this.samlIdentityProvider) {
      this.userPoolClient.node.addDependency(this.samlIdentityProvider);
    }

    // Create Cognito User Pool Domain with consistent naming
    // Domain prefix can only contain lowercase letters, numbers, and hyphens
    // Remove any non-alphanumeric characters except hyphens and convert to lowercase
    const accountId = this.account.substring(0, 8).replace(/[^a-zA-Z0-9-]/g, '');
    const domainPrefix = `chatbot-${environment}-${accountId}`.toLowerCase();
    
    // Validate domain prefix format
    if (!/^[a-z0-9-]+$/.test(domainPrefix)) {
      throw new Error(`Invalid domain prefix: ${domainPrefix}. Must contain only lowercase letters, numbers, and hyphens.`);
    }
    
    this.userPoolDomain = new cognito.UserPoolDomain(this, 'ChatbotUserPoolDomain', {
      userPool: this.userPool,
      cognitoDomain: {
        domainPrefix: domainPrefix,
      },
    });

    // Export values for cross-stack references
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
      exportName: `${this.stackName}-UserPoolId`,
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
      exportName: `${this.stackName}-UserPoolClientId`,
    });

    new cdk.CfnOutput(this, 'UserPoolDomain', {
      value: this.userPoolDomain.domainName,
      description: 'Cognito User Pool Domain',
      exportName: `${this.stackName}-UserPoolDomain`,
    });

    new cdk.CfnOutput(this, 'UserPoolArn', {
      value: this.userPool.userPoolArn,
      description: 'Cognito User Pool ARN',
      exportName: `${this.stackName}-UserPoolArn`,
    });

    new cdk.CfnOutput(this, 'AuthLoginUrl', {
      value: `https://${this.userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com/login`,
      description: 'Cognito Login Base URL',
    });

    // Task 1.1.6: Add CloudFormation outputs for SAML endpoints
    // These outputs are needed for configuring IAM Identity Center
    new cdk.CfnOutput(this, 'SamlAcsUrl', {
      value: `https://${this.userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com/saml2/idpresponse`,
      description: 'SAML Assertion Consumer Service (ACS) URL - Configure this in IAM Identity Center',
      exportName: `${this.stackName}-SamlAcsUrl`,
    });

    new cdk.CfnOutput(this, 'SamlEntityId', {
      value: `urn:amazon:cognito:sp:${this.userPool.userPoolId}`,
      description: 'SAML Entity ID (Audience) - Configure this in IAM Identity Center',
      exportName: `${this.stackName}-SamlEntityId`,
    });

    new cdk.CfnOutput(this, 'SamlMetadataUrl', {
      value: `https://cognito-idp.${this.region}.amazonaws.com/${this.userPool.userPoolId}/.well-known/saml-metadata`,
      description: 'Cognito SAML Metadata URL - Download this for IAM Identity Center configuration',
      exportName: `${this.stackName}-SamlMetadataUrl`,
    });

    new cdk.CfnOutput(this, 'JwksUrl', {
      value: `https://cognito-idp.${this.region}.amazonaws.com/${this.userPool.userPoolId}/.well-known/jwks.json`,
      description: 'JSON Web Key Set (JWKS) URL for JWT validation',
      exportName: `${this.stackName}-JwksUrl`,
    });

    new cdk.CfnOutput(this, 'CognitoIssuerUrl', {
      value: `https://cognito-idp.${this.region}.amazonaws.com/${this.userPool.userPoolId}`,
      description: 'Cognito Issuer URL for JWT validation',
      exportName: `${this.stackName}-CognitoIssuerUrl`,
    });

    // Output the OAuth authorize URL for SSO login
    if (enableSso) {
      new cdk.CfnOutput(this, 'SsoLoginUrl', {
        value: `https://${this.userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com/oauth2/authorize?identity_provider=IAMIdentityCenter&redirect_uri=${encodeURIComponent(callbackUrls[0])}&response_type=code&client_id=${this.userPoolClient.userPoolClientId}&scope=openid+email+profile`,
        description: 'SSO Login URL - Use this to initiate SSO authentication',
        exportName: `${this.stackName}-SsoLoginUrl`,
      });

      new cdk.CfnOutput(this, 'SsoLogoutUrl', {
        value: `https://${this.userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com/logout?client_id=${this.userPoolClient.userPoolClientId}&logout_uri=${encodeURIComponent(logoutUrls[0])}`,
        description: 'SSO Logout URL - Use this to initiate logout',
        exportName: `${this.stackName}-SsoLogoutUrl`,
      });
    }
  }
}