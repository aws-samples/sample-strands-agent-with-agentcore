/**
 * Code Agent A2A Runtime Stack
 * Deploys Code Agent (Claude Agent SDK wrapper) as AgentCore A2A Runtime
 * Based on research-agent pattern - no S3 chart bucket or Code Interpreter needed
 */
import * as cdk from 'aws-cdk-lib';
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import { Construct } from 'constructs';
export interface CodeAgentRuntimeStackProps extends cdk.StackProps {
    projectName?: string;
    environment?: string;
    anthropicModel?: string;
}
export declare class CodeAgentRuntimeStack extends cdk.Stack {
    readonly runtime: agentcore.CfnRuntime;
    readonly runtimeArn: string;
    constructor(scope: Construct, id: string, props?: CodeAgentRuntimeStackProps);
}
