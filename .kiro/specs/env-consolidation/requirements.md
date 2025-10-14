# Requirements Document

## Introduction

The current deployment system manages multiple environment files across different components (backend, frontend, and infrastructure), leading to configuration drift and complexity. This feature will consolidate all environment configuration to use a single master environment file (`agent-blueprint/.env`) as the sole source of truth for all applications and deployment scripts.

## Requirements

### Requirement 1

**User Story:** As a developer, I want all applications to use a single master environment file, so that I only need to manage configuration in one place.

#### Acceptance Criteria

1. WHEN deploying the application THEN the deploy script SHALL only read from `agent-blueprint/.env`
2. WHEN the deploy script runs THEN it SHALL NOT create or modify any other .env files
3. WHEN applications start THEN they SHALL load environment variables from the master file only
4. IF the master .env file is missing THEN the system SHALL provide clear error messages with setup instructions

### Requirement 2

**User Story:** As a DevOps engineer, I want the deployment script to be simplified, so that environment management is more reliable and maintainable.

#### Acceptance Criteria

1. WHEN the deploy script runs THEN it SHALL remove all logic for creating multiple .env files
2. WHEN Cognito configuration is retrieved THEN it SHALL only update the master .env file
3. WHEN the script completes THEN no duplicate environment files SHALL exist
4. IF environment variables are missing THEN the script SHALL fail with descriptive error messages

### Requirement 3

**User Story:** As a developer, I want existing redundant environment files to be cleaned up, so that there's no confusion about which configuration is active.

#### Acceptance Criteria

1. WHEN the consolidation is complete THEN all redundant .env files SHALL be removed
2. WHEN applications are configured THEN they SHALL reference the master .env file path
3. WHEN documentation is updated THEN it SHALL reflect the single-file approach
4. IF legacy .env files exist THEN they SHALL be automatically cleaned up during deployment

### Requirement 4

**User Story:** As a developer, I want clear documentation and examples, so that I understand how to configure the consolidated environment system.

#### Acceptance Criteria

1. WHEN setting up the project THEN clear instructions SHALL be provided for the master .env file
2. WHEN examples are provided THEN they SHALL reference only the master configuration
3. WHEN error messages are shown THEN they SHALL guide users to the correct configuration file
4. IF configuration is invalid THEN helpful validation messages SHALL be displayed