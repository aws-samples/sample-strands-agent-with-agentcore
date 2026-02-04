/**
 * Authentication verification utilities for iframe context
 * This module provides functions to verify that authentication works correctly in embedded scenarios
 */

import { getCurrentUser, signOut } from 'aws-amplify/auth';

export interface AuthVerificationResult {
    test: string;
    passed: boolean;
    message: string;
    details?: any;
}

/**
 * Comprehensive authentication verification for iframe context
 */
export class AuthVerification {
    private results: AuthVerificationResult[] = [];

    /**
     * Run all authentication verification tests
     */
    async runAllTests(): Promise<AuthVerificationResult[]> {
        this.results = [];

        await this.testCurrentUserAccess();
        await this.testIframeContext();
        await this.testSessionPersistence();
        await this.testCrossOriginCommunication();

        return this.results;
    }

    /**
     * Test if we can access current user information
     */
    private async testCurrentUserAccess(): Promise<void> {
        try {
            const user = await getCurrentUser();
            this.addResult('Current User Access', true,
                `Successfully retrieved user: ${user.userId}`, { userId: user.userId });
        } catch (error) {
            this.addResult('Current User Access', false,
                `Failed to get current user: ${error}`, { error });
        }
    }

    /**
     * Test iframe context detection
     */
    private async testIframeContext(): Promise<void> {
        try {
            const isInIframe = typeof window !== 'undefined' && window.self !== window.top;
            const canAccessParent = this.canAccessParentWindow();

            this.addResult('Iframe Context Detection', true,
                `Iframe detected: ${isInIframe}, Parent accessible: ${canAccessParent}`,
                { isInIframe, canAccessParent });
        } catch (error) {
            this.addResult('Iframe Context Detection', false,
                `Error detecting iframe context: ${error}`, { error });
        }
    }

    /**
     * Test session persistence mechanisms
     */
    private async testSessionPersistence(): Promise<void> {
        try {
            // Check for Amplify tokens in storage
            const hasLocalStorage = typeof localStorage !== 'undefined';
            const hasSessionStorage = typeof sessionStorage !== 'undefined';

            let amplifyTokens = 0;
            if (hasLocalStorage) {
                amplifyTokens += Object.keys(localStorage).filter(key =>
                    key.includes('amplify') || key.includes('cognito')).length;
            }

            if (hasSessionStorage) {
                amplifyTokens += Object.keys(sessionStorage).filter(key =>
                    key.includes('amplify') || key.includes('cognito')).length;
            }

            this.addResult('Session Persistence', amplifyTokens > 0,
                `Found ${amplifyTokens} authentication tokens in storage`,
                { amplifyTokens, hasLocalStorage, hasSessionStorage });
        } catch (error) {
            this.addResult('Session Persistence', false,
                `Error checking session persistence: ${error}`, { error });
        }
    }

    /**
     * Test cross-origin communication capabilities
     */
    private async testCrossOriginCommunication(): Promise<void> {
        try {
            const canPostMessage = typeof window !== 'undefined' &&
                window.parent &&
                typeof window.parent.postMessage === 'function';

            if (canPostMessage) {
                // Test posting a message
                window.parent.postMessage({
                    type: 'CHATBOT_AUTH_VERIFICATION',
                    payload: { test: true, timestamp: Date.now() }
                }, '*');

                this.addResult('Cross-Origin Communication', true,
                    'Successfully posted test message to parent window');
            } else {
                this.addResult('Cross-Origin Communication', false,
                    'Cannot post messages to parent window');
            }
        } catch (error) {
            this.addResult('Cross-Origin Communication', false,
                `Error testing cross-origin communication: ${error}`, { error });
        }
    }

    /**
     * Check if we can access parent window (should be limited due to security)
     */
    private canAccessParentWindow(): boolean {
        try {
            if (typeof window === 'undefined' || !window.parent || window.parent === window) {
                return false;
            }

            // Try to access parent location (should fail due to same-origin policy)
            const parentLocation = window.parent.location.href;
            return true; // If we get here, we have unexpected access
        } catch (error) {
            return false; // Expected - same-origin policy should prevent access
        }
    }

    /**
     * Add a test result
     */
    private addResult(test: string, passed: boolean, message: string, details?: any): void {
        this.results.push({ test, passed, message, details });
    }

    /**
     * Get all test results
     */
    getResults(): AuthVerificationResult[] {
        return [...this.results];
    }

    /**
     * Get summary of test results
     */
    getSummary(): { total: number; passed: number; failed: number } {
        const total = this.results.length;
        const passed = this.results.filter(r => r.passed).length;
        const failed = total - passed;

        return { total, passed, failed };
    }
}

/**
 * Quick verification function for use in console or components
 */
export async function quickAuthVerification(): Promise<void> {
    console.log(' Running authentication verification...');

    const verifier = new AuthVerification();
    const results = await verifier.runAllTests();
    const summary = verifier.getSummary();

    console.log(`📊 Verification Summary: ${summary.passed}/${summary.total} tests passed`);

    results.forEach(result => {
        const icon = result.passed ? '✅' : '❌';
        console.log(`${icon} ${result.test}: ${result.message}`);
        if (result.details) {
            console.log('   Details:', result.details);
        }
    });

    if (summary.failed > 0) {
        console.warn(`⚠️ ${summary.failed} tests failed - check authentication configuration`);
    } else {
        console.log('🎉 All authentication tests passed!');
    }
}

// Export singleton for easy use
export const authVerification = new AuthVerification();