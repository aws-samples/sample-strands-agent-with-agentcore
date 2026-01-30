"""
User Management Module for SSO Authentication.

This module provides DynamoDB-backed user profile management for authenticated users.
User profiles are created on first login and store user preferences and metadata.

Features:
- User profile creation (on first SSO login)
- User profile retrieval
- User profile updates
- User preferences management
- Last login tracking

DynamoDB Table Schema:
- userId (PK): User's unique identifier from Cognito (sub)
- sk (SK): Sort key for different record types (e.g., "PROFILE", "PREFERENCES")
- email: User's email address
- name: User's display name
- preferences: User preferences (theme, language, notifications)
- createdAt: ISO 8601 timestamp of profile creation
- lastLoginAt: ISO 8601 timestamp of last login

Usage:
    from auth.user_manager import UserManager
    
    manager = UserManager(table_name="chatbot-users")
    
    # Create or update user profile on login
    profile = await manager.create_or_update_profile(
        user_id="user-123",
        email="user@example.com",
        name="John Doe"
    )
    
    # Get user profile
    profile = await manager.get_profile(user_id="user-123")
    
    # Update preferences
    await manager.update_preferences(
        user_id="user-123",
        preferences=UserPreferences(theme="dark", language="en")
    )
"""

import os
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any, Literal
from dataclasses import dataclass, field

import boto3
from botocore.exceptions import ClientError
from pydantic import BaseModel, Field


logger = logging.getLogger(__name__)


# ============================================================
# Exceptions
# ============================================================

class UserNotFoundError(Exception):
    """Raised when a user profile is not found in the database."""
    
    def __init__(self, user_id: str):
        self.user_id = user_id
        super().__init__(f"User not found: {user_id}")


class UserAlreadyExistsError(Exception):
    """Raised when attempting to create a user that already exists."""
    
    def __init__(self, user_id: str):
        self.user_id = user_id
        super().__init__(f"User already exists: {user_id}")


# ============================================================
# Data Models
# ============================================================

class UserPreferences(BaseModel):
    """User preferences for application customization.
    
    Attributes:
        theme: UI theme preference (light/dark/system)
        language: Preferred language code (e.g., "en", "es")
        notifications: Whether to enable notifications
        timezone: User's preferred timezone
        compact_mode: Whether to use compact UI mode
    """
    theme: Literal["light", "dark", "system"] = Field(
        default="system",
        description="UI theme preference"
    )
    language: str = Field(
        default="en",
        description="Preferred language code"
    )
    notifications: bool = Field(
        default=True,
        description="Enable notifications"
    )
    timezone: Optional[str] = Field(
        default=None,
        description="Preferred timezone (e.g., 'America/New_York')"
    )
    compact_mode: bool = Field(
        default=False,
        description="Use compact UI mode"
    )
    
    class Config:
        extra = "allow"  # Allow additional preference fields


class UserProfile(BaseModel):
    """Represents a user profile.
    
    Attributes:
        user_id: User's unique identifier from Cognito (sub)
        email: User's email address
        name: User's display name
        preferences: User preferences
        created_at: Timestamp of profile creation
        last_login_at: Timestamp of last login
        login_count: Number of times user has logged in
        metadata: Additional user metadata
    """
    user_id: str = Field(..., description="User's unique identifier (Cognito sub)")
    email: str = Field(..., description="User's email address")
    name: str = Field(..., description="User's display name")
    preferences: UserPreferences = Field(
        default_factory=UserPreferences,
        description="User preferences"
    )
    created_at: datetime = Field(..., description="Profile creation timestamp")
    last_login_at: datetime = Field(..., description="Last login timestamp")
    login_count: int = Field(default=1, description="Number of logins")
    metadata: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Additional user metadata"
    )
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert profile to dictionary for API responses.
        
        Returns:
            Dictionary representation of the profile
        """
        return {
            "userId": self.user_id,
            "email": self.email,
            "name": self.name,
            "preferences": self.preferences.model_dump(),
            "createdAt": self.created_at.isoformat(),
            "lastLoginAt": self.last_login_at.isoformat(),
            "loginCount": self.login_count,
            "metadata": self.metadata,
        }


# ============================================================
# Configuration
# ============================================================

@dataclass
class UserConfig:
    """Configuration for user management.
    
    Attributes:
        table_name: DynamoDB table name for users
        region: AWS region for DynamoDB
        endpoint_url: Optional DynamoDB endpoint URL (for local development)
    """
    table_name: str = field(default_factory=lambda: os.getenv(
        "USER_TABLE_NAME", "chatbot-users"
    ))
    region: str = field(default_factory=lambda: os.getenv(
        "AWS_DEFAULT_REGION", "us-east-1"
    ))
    endpoint_url: Optional[str] = field(default_factory=lambda: os.getenv(
        "DYNAMODB_ENDPOINT_URL"
    ))
    
    @classmethod
    def from_env(cls) -> "UserConfig":
        """Create configuration from environment variables.
        
        Environment variables:
            USER_TABLE_NAME: DynamoDB table name
            AWS_DEFAULT_REGION: AWS region
            DYNAMODB_ENDPOINT_URL: Optional endpoint URL for local dev
        """
        return cls()


# ============================================================
# User Manager
# ============================================================

class UserManager:
    """Manages user profiles with DynamoDB backend.
    
    This class provides CRUD operations for user profiles, including:
    - Profile creation on first login
    - Profile retrieval
    - Profile updates
    - Preferences management
    - Login tracking
    
    Example:
        config = UserConfig(table_name="my-users")
        manager = UserManager(config=config)
        
        # Create or update profile on login
        profile = await manager.create_or_update_profile(
            user_id="user-123",
            email="user@example.com",
            name="John Doe"
        )
        
        # Get profile
        profile = await manager.get_profile("user-123")
        
        # Update preferences
        await manager.update_preferences(
            "user-123",
            UserPreferences(theme="dark")
        )
    """
    
    # Sort key values for different record types
    SK_PROFILE = "PROFILE"
    
    def __init__(self, config: Optional[UserConfig] = None):
        """Initialize the user manager.
        
        Args:
            config: User configuration (uses defaults if not provided)
        """
        self.config = config or UserConfig.from_env()
        self._dynamodb = None
        self._table = None
        
        logger.info(f"UserManager initialized: table={self.config.table_name}")
    
    @property
    def dynamodb(self):
        """Lazy initialization of DynamoDB resource."""
        if self._dynamodb is None:
            self._dynamodb = boto3.resource(
                "dynamodb",
                region_name=self.config.region,
                endpoint_url=self.config.endpoint_url
            )
        return self._dynamodb
    
    @property
    def table(self):
        """Lazy initialization of DynamoDB table."""
        if self._table is None:
            self._table = self.dynamodb.Table(self.config.table_name)
        return self._table
    
    async def create_profile(
        self,
        user_id: str,
        email: str,
        name: str,
        preferences: Optional[UserPreferences] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> UserProfile:
        """Create a new user profile.
        
        Args:
            user_id: User's unique identifier (Cognito sub)
            email: User's email address
            name: User's display name
            preferences: Optional initial preferences
            metadata: Optional additional metadata
            
        Returns:
            The created UserProfile object
            
        Raises:
            UserAlreadyExistsError: If user already exists
            ClientError: If DynamoDB operation fails
        """
        now = datetime.now(timezone.utc)
        prefs = preferences or UserPreferences()
        
        item = {
            "userId": user_id,
            "sk": self.SK_PROFILE,
            "email": email,
            "name": name,
            "preferences": prefs.model_dump(),
            "createdAt": now.isoformat(),
            "lastLoginAt": now.isoformat(),
            "loginCount": 1,
        }
        
        if metadata:
            item["metadata"] = metadata
        
        try:
            # Use condition to prevent overwriting existing profile
            self.table.put_item(
                Item=item,
                ConditionExpression="attribute_not_exists(userId)"
            )
            
            logger.info(
                f"User profile created: user_id={user_id}, email={email}"
            )
            
            return UserProfile(
                user_id=user_id,
                email=email,
                name=name,
                preferences=prefs,
                created_at=now,
                last_login_at=now,
                login_count=1,
                metadata=metadata
            )
            
        except ClientError as e:
            if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
                logger.warning(f"User already exists: {user_id}")
                raise UserAlreadyExistsError(user_id)
            logger.error(
                f"Failed to create user profile: {e.response['Error']['Message']}",
                extra={"user_id": user_id, "email": email}
            )
            raise
    
    async def get_profile(self, user_id: str) -> UserProfile:
        """Retrieve a user profile by ID.
        
        Args:
            user_id: The user ID to retrieve
            
        Returns:
            The UserProfile object
            
        Raises:
            UserNotFoundError: If user doesn't exist
            ClientError: If DynamoDB operation fails
        """
        try:
            response = self.table.get_item(
                Key={
                    "userId": user_id,
                    "sk": self.SK_PROFILE
                }
            )
            
            item = response.get("Item")
            if not item:
                logger.warning(f"User not found: {user_id}")
                raise UserNotFoundError(user_id)
            
            # Parse preferences
            preferences = UserPreferences(**item.get("preferences", {}))
            
            profile = UserProfile(
                user_id=item["userId"],
                email=item["email"],
                name=item["name"],
                preferences=preferences,
                created_at=datetime.fromisoformat(item["createdAt"]),
                last_login_at=datetime.fromisoformat(item["lastLoginAt"]),
                login_count=item.get("loginCount", 1),
                metadata=item.get("metadata")
            )
            
            logger.debug(f"User profile retrieved: user_id={user_id}")
            return profile
            
        except ClientError as e:
            logger.error(
                f"Failed to get user profile: {e.response['Error']['Message']}",
                extra={"user_id": user_id}
            )
            raise
    
    async def profile_exists(self, user_id: str) -> bool:
        """Check if a user profile exists.
        
        Args:
            user_id: The user ID to check
            
        Returns:
            True if profile exists, False otherwise
        """
        try:
            response = self.table.get_item(
                Key={
                    "userId": user_id,
                    "sk": self.SK_PROFILE
                },
                ProjectionExpression="userId"
            )
            return "Item" in response
        except ClientError:
            return False
    
    async def create_or_update_profile(
        self,
        user_id: str,
        email: str,
        name: str,
        metadata: Optional[Dict[str, Any]] = None
    ) -> UserProfile:
        """Create a new profile or update existing on login.
        
        This method is typically called during the SSO login flow.
        If the user doesn't exist, a new profile is created.
        If the user exists, the last login time and count are updated.
        
        Args:
            user_id: User's unique identifier (Cognito sub)
            email: User's email address
            name: User's display name
            metadata: Optional additional metadata
            
        Returns:
            The UserProfile object (created or updated)
            
        Raises:
            ClientError: If DynamoDB operation fails
        """
        now = datetime.now(timezone.utc)
        
        try:
            # Try to update existing profile
            response = self.table.update_item(
                Key={
                    "userId": user_id,
                    "sk": self.SK_PROFILE
                },
                UpdateExpression=(
                    "SET lastLoginAt = :now, "
                    "loginCount = if_not_exists(loginCount, :zero) + :one, "
                    "email = :email, "
                    "#n = :name"
                ),
                ExpressionAttributeNames={
                    "#n": "name"  # 'name' is a reserved word
                },
                ExpressionAttributeValues={
                    ":now": now.isoformat(),
                    ":zero": 0,
                    ":one": 1,
                    ":email": email,
                    ":name": name
                },
                ConditionExpression="attribute_exists(userId)",
                ReturnValues="ALL_NEW"
            )
            
            item = response["Attributes"]
            preferences = UserPreferences(**item.get("preferences", {}))
            
            logger.info(
                f"User profile updated on login: user_id={user_id}, "
                f"login_count={item.get('loginCount', 1)}"
            )
            
            return UserProfile(
                user_id=item["userId"],
                email=item["email"],
                name=item["name"],
                preferences=preferences,
                created_at=datetime.fromisoformat(item["createdAt"]),
                last_login_at=datetime.fromisoformat(item["lastLoginAt"]),
                login_count=item.get("loginCount", 1),
                metadata=item.get("metadata")
            )
            
        except ClientError as e:
            if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
                # User doesn't exist, create new profile
                logger.info(f"Creating new user profile: user_id={user_id}")
                return await self.create_profile(
                    user_id=user_id,
                    email=email,
                    name=name,
                    metadata=metadata
                )
            logger.error(
                f"Failed to update user profile: {e.response['Error']['Message']}",
                extra={"user_id": user_id}
            )
            raise
    
    async def update_profile(
        self,
        user_id: str,
        name: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> UserProfile:
        """Update user profile fields.
        
        Args:
            user_id: The user ID to update
            name: Optional new display name
            metadata: Optional new metadata (replaces existing)
            
        Returns:
            The updated UserProfile object
            
        Raises:
            UserNotFoundError: If user doesn't exist
            ClientError: If DynamoDB operation fails
        """
        # Build update expression dynamically
        update_parts = []
        expression_values = {}
        expression_names = {}
        
        if name is not None:
            update_parts.append("#n = :name")
            expression_values[":name"] = name
            expression_names["#n"] = "name"
        
        if metadata is not None:
            update_parts.append("metadata = :meta")
            expression_values[":meta"] = metadata
        
        if not update_parts:
            # Nothing to update, just return current profile
            return await self.get_profile(user_id)
        
        update_expression = "SET " + ", ".join(update_parts)
        
        try:
            response = self.table.update_item(
                Key={
                    "userId": user_id,
                    "sk": self.SK_PROFILE
                },
                UpdateExpression=update_expression,
                ExpressionAttributeValues=expression_values,
                ExpressionAttributeNames=expression_names if expression_names else None,
                ConditionExpression="attribute_exists(userId)",
                ReturnValues="ALL_NEW"
            )
            
            item = response["Attributes"]
            preferences = UserPreferences(**item.get("preferences", {}))
            
            logger.info(f"User profile updated: user_id={user_id}")
            
            return UserProfile(
                user_id=item["userId"],
                email=item["email"],
                name=item["name"],
                preferences=preferences,
                created_at=datetime.fromisoformat(item["createdAt"]),
                last_login_at=datetime.fromisoformat(item["lastLoginAt"]),
                login_count=item.get("loginCount", 1),
                metadata=item.get("metadata")
            )
            
        except ClientError as e:
            if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
                raise UserNotFoundError(user_id)
            logger.error(
                f"Failed to update user profile: {e.response['Error']['Message']}",
                extra={"user_id": user_id}
            )
            raise
    
    async def get_preferences(self, user_id: str) -> UserPreferences:
        """Get user preferences.
        
        Args:
            user_id: The user ID to get preferences for
            
        Returns:
            The UserPreferences object
            
        Raises:
            UserNotFoundError: If user doesn't exist
            ClientError: If DynamoDB operation fails
        """
        profile = await self.get_profile(user_id)
        return profile.preferences
    
    async def update_preferences(
        self,
        user_id: str,
        preferences: UserPreferences
    ) -> UserPreferences:
        """Update user preferences.
        
        Args:
            user_id: The user ID to update preferences for
            preferences: New preferences to set
            
        Returns:
            The updated UserPreferences object
            
        Raises:
            UserNotFoundError: If user doesn't exist
            ClientError: If DynamoDB operation fails
        """
        try:
            response = self.table.update_item(
                Key={
                    "userId": user_id,
                    "sk": self.SK_PROFILE
                },
                UpdateExpression="SET preferences = :prefs",
                ExpressionAttributeValues={
                    ":prefs": preferences.model_dump()
                },
                ConditionExpression="attribute_exists(userId)",
                ReturnValues="ALL_NEW"
            )
            
            logger.info(f"User preferences updated: user_id={user_id}")
            
            return UserPreferences(**response["Attributes"]["preferences"])
            
        except ClientError as e:
            if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
                raise UserNotFoundError(user_id)
            logger.error(
                f"Failed to update user preferences: {e.response['Error']['Message']}",
                extra={"user_id": user_id}
            )
            raise
    
    async def update_single_preference(
        self,
        user_id: str,
        key: str,
        value: Any
    ) -> UserPreferences:
        """Update a single preference value.
        
        Args:
            user_id: The user ID to update
            key: The preference key to update
            value: The new value
            
        Returns:
            The updated UserPreferences object
            
        Raises:
            UserNotFoundError: If user doesn't exist
            ClientError: If DynamoDB operation fails
        """
        try:
            response = self.table.update_item(
                Key={
                    "userId": user_id,
                    "sk": self.SK_PROFILE
                },
                UpdateExpression="SET preferences.#key = :val",
                ExpressionAttributeNames={"#key": key},
                ExpressionAttributeValues={":val": value},
                ConditionExpression="attribute_exists(userId)",
                ReturnValues="ALL_NEW"
            )
            
            logger.info(
                f"User preference updated: user_id={user_id}, key={key}"
            )
            
            return UserPreferences(**response["Attributes"]["preferences"])
            
        except ClientError as e:
            if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
                raise UserNotFoundError(user_id)
            logger.error(
                f"Failed to update user preference: {e.response['Error']['Message']}",
                extra={"user_id": user_id, "key": key}
            )
            raise
    
    async def delete_profile(self, user_id: str) -> bool:
        """Delete a user profile.
        
        Args:
            user_id: The user ID to delete
            
        Returns:
            True if profile was deleted, False if it didn't exist
            
        Raises:
            ClientError: If DynamoDB operation fails
        """
        try:
            response = self.table.delete_item(
                Key={
                    "userId": user_id,
                    "sk": self.SK_PROFILE
                },
                ReturnValues="ALL_OLD"
            )
            
            deleted = "Attributes" in response
            if deleted:
                logger.info(f"User profile deleted: user_id={user_id}")
            else:
                logger.warning(f"User profile not found for deletion: {user_id}")
            
            return deleted
            
        except ClientError as e:
            logger.error(
                f"Failed to delete user profile: {e.response['Error']['Message']}",
                extra={"user_id": user_id}
            )
            raise
    
    async def get_user_by_email(self, email: str) -> Optional[UserProfile]:
        """Find a user by email address.
        
        Note: This requires a GSI on email or performs a scan.
        For production, consider adding a GSI on the email attribute.
        
        Args:
            email: The email address to search for
            
        Returns:
            The UserProfile if found, None otherwise
            
        Raises:
            ClientError: If DynamoDB operation fails
        """
        try:
            # Scan with filter (consider GSI for production)
            response = self.table.scan(
                FilterExpression="email = :email AND sk = :sk",
                ExpressionAttributeValues={
                    ":email": email,
                    ":sk": self.SK_PROFILE
                }
            )
            
            items = response.get("Items", [])
            if not items:
                return None
            
            item = items[0]
            preferences = UserPreferences(**item.get("preferences", {}))
            
            return UserProfile(
                user_id=item["userId"],
                email=item["email"],
                name=item["name"],
                preferences=preferences,
                created_at=datetime.fromisoformat(item["createdAt"]),
                last_login_at=datetime.fromisoformat(item["lastLoginAt"]),
                login_count=item.get("loginCount", 1),
                metadata=item.get("metadata")
            )
            
        except ClientError as e:
            logger.error(
                f"Failed to get user by email: {e.response['Error']['Message']}",
                extra={"email": email}
            )
            raise
