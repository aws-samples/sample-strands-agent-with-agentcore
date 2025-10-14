/**
 * Utility functions for testing authentication in iframe context
 */

export interface AuthTestResult {
  testName: string;
  status: 'pass' | 'fail' | 'pending';
  message: string;
  timestamp: Date;
}

export class IframeAuthTester {
  private results: AuthTestResult[] = [];
  private callbacks: ((results: AuthTestResult[]) => void)[] = [];

  constructor() {
    this.setupMessageListener();
  }

  private setupMessageListener() {
    if (typeof window !== 'undefined') {
      window.addEventListener('message', (event) => {
        if (event.data?.type === 'CHATBOT_AUTH_STATUS') {
          this.addResult('Authentication Status Message', 'pass', 
            `Received auth status: ${event.data.payload.isAuthenticated ? 'authenticated' : 'not authenticated'}`);
        } else if (event.data?.type === 'CHATBOT_AUTH_ERROR') {
          this.addResult('Authentication Error Message', 'fail', 
            `Received auth error: ${event.data.payload.error}`);
        }
      });
    }
  }

  private addResult(testName: string, status: 'pass' | 'fail' | 'pending', message: string) {
    const result: AuthTestResult = {
      testName,
      status,
      message,
      timestamp: new Date()
    };
    
    this.results.push(result);
    this.callbacks.forEach(callback => callback([...this.results]));
  }

  public onResultsUpdate(callback: (results: AuthTestResult[]) => void) {
    this.callbacks.push(callback);
  }

  public clearResults() {
    this.results = [];
    this.callbacks.forEach(callback => callback([]));
  }

  public async runAuthenticationTests(): Promise<AuthTestResult[]> {
    this.clearResults();
    this.addResult('Test Suite Started', 'pending', 'Beginning iframe authentication tests...');

    // Test 1: Check iframe detection
    await this.testIframeDetection();
    
    // Test 2: Check authentication UI loading
    await this.testAuthenticationUILoading();
    
    // Test 3: Check session persistence
    await this.testSessionPersistence();
    
    // Test 4: Check cross-origin communication
    await this.testCrossOriginCommunication();
    
    // Test 5: Check authentication redirects
    await this.testAuthenticationRedirects();

    this.addResult('Test Suite Completed', 'pass', 'All automated tests completed');
    return [...this.results];
  }

  private async testIframeDetection(): Promise<void> {
    return new Promise((resolve) => {
      try {
        const isInIframe = window.self !== window.top;
        if (isInIframe) {
          this.addResult('Iframe Detection', 'pass', 'Successfully detected iframe context');
        } else {
          this.addResult('Iframe Detection', 'pending', 'Not running in iframe - test in embedded context');
        }
      } catch (error) {
        this.addResult('Iframe Detection', 'fail', `Error detecting iframe: ${error}`);
      }
      resolve();
    });
  }

  private async testAuthenticationUILoading(): Promise<void> {
    return new Promise((resolve) => {
      // Check if authentication UI elements are present
      setTimeout(() => {
        try {
          // Look for common Amplify UI elements
          const authElements = document.querySelectorAll('[data-amplify-authenticator]');
          const loginForms = document.querySelectorAll('form[data-amplify-form]');
          const chatInterface = document.querySelector('[data-testid="chat-interface"]') || 
                               document.querySelector('.chat-interface') ||
                               document.querySelector('textarea[placeholder*="Ask"]');

          if (chatInterface) {
            this.addResult('Authentication UI Loading', 'pass', 'Chat interface loaded - user appears to be authenticated');
          } else if (authElements.length > 0 || loginForms.length > 0) {
            this.addResult('Authentication UI Loading', 'pass', 'Authentication UI loaded successfully');
          } else {
            this.addResult('Authentication UI Loading', 'pending', 'UI state unclear - manual verification needed');
          }
        } catch (error) {
          this.addResult('Authentication UI Loading', 'fail', `Error checking UI: ${error}`);
        }
        resolve();
      }, 2000);
    });
  }

  private async testSessionPersistence(): Promise<void> {
    return new Promise((resolve) => {
      try {
        // Check if there are any authentication tokens in localStorage/sessionStorage
        const hasAmplifyTokens = typeof window !== 'undefined' && (
          localStorage.getItem('amplify-signin-with-hostedUI') ||
          Object.keys(localStorage).some(key => key.includes('amplify')) ||
          Object.keys(sessionStorage).some(key => key.includes('amplify'))
        );

        if (hasAmplifyTokens) {
          this.addResult('Session Persistence', 'pass', 'Authentication tokens found in storage');
        } else {
          this.addResult('Session Persistence', 'pending', 'No tokens found - may be first visit or logged out');
        }
      } catch (error) {
        this.addResult('Session Persistence', 'fail', `Error checking session: ${error}`);
      }
      resolve();
    });
  }

  private async testCrossOriginCommunication(): Promise<void> {
    return new Promise((resolve) => {
      let messageReceived = false;
      
      const messageHandler = (event: MessageEvent) => {
        if (event.data?.type?.startsWith('CHATBOT_')) {
          messageReceived = true;
          this.addResult('Cross-Origin Communication', 'pass', 
            `Successfully received message: ${event.data.type}`);
          window.removeEventListener('message', messageHandler);
          resolve();
        }
      };

      window.addEventListener('message', messageHandler);

      // Wait for messages for 3 seconds
      setTimeout(() => {
        if (!messageReceived) {
          window.removeEventListener('message', messageHandler);
          this.addResult('Cross-Origin Communication', 'pending', 
            'No messages received - communication may not be implemented');
          resolve();
        }
      }, 3000);
    });
  }

  private async testAuthenticationRedirects(): Promise<void> {
    return new Promise((resolve) => {
      try {
        // Check if we can detect redirect handling
        const currentUrl = window.location.href;
        const hasAuthParams = currentUrl.includes('code=') || currentUrl.includes('access_token=');
        
        if (hasAuthParams) {
          this.addResult('Authentication Redirects', 'pass', 'Authentication redirect parameters detected');
        } else {
          // Check if we're in a state where redirects would work
          const isInIframe = window.self !== window.top;
          if (isInIframe) {
            this.addResult('Authentication Redirects', 'pending', 
              'In iframe - redirects may be handled by parent window');
          } else {
            this.addResult('Authentication Redirects', 'pass', 
              'No redirect params (normal for authenticated state)');
          }
        }
      } catch (error) {
        this.addResult('Authentication Redirects', 'fail', `Error checking redirects: ${error}`);
      }
      resolve();
    });
  }

  public getResults(): AuthTestResult[] {
    return [...this.results];
  }
}

// Export singleton instance
export const iframeAuthTester = new IframeAuthTester();