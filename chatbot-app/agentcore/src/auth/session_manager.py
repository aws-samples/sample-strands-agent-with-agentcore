"""
Session Management Module for SSO Authentication.

This module provides DynamoDB-backed session management for authenticated users.
Sessions are created after successful SSO authentication and are used to track
user activity, manage session lifecycle, and enforce security policies.

Features:
- Session creation with configurable TTL
- Session retrieval and validation
- Session update and activity tracking
- Session deletion and cleanup
- Automatic TTL-based expiration via DynamoDB

DynamoDB Table Schema:
- sessionId (PK): Unique session identifier (UUID)
- userId (SK): User's unique identifier from Cognito (sub)
- email: User's email address
- name: User's display name
- createdAt: ISO 8601 timestamp of session creation
- lastAccessedAt: ISO 8601 timestamp of last activity
- expiresAt: Unix timestamp for DynamoDB TTL
- metadata: Additional session metadata (IP, user agent, etc.)

Usage:
    from auth.session_manager import SessionManager, SessionConfig
    
    config = SessionConfig(
        table_name="chatbot-sessions",
        session_duration_hours=8,
        idle_timeout_minutes=60
    )
    manager = SessionManager(config=config)
    
    # Create a session
    session = await manager.create_session(
        user_id="user-123",
        email="user@example.com",
        name="John Doe"
    )
    
    # Get a session
    session = await manager.get_session(session_id="session-uuid")
    
    # Update session activity
    await manager.update_session_activity(session_id="session-uuid")
    
    # Delete a session
    await manager.delete_session(session_id="session-uuid")
"""

import os
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any
from dataclasses import dataclass, field

import boto3
from botocore.exceptions import ClientError
from pydantic import BaseModel, Field


logger = logging.getLogger(__name__)


# ============================================================
# Exceptions
# ============================================================

class SessionNotFoundError(Exception):
    """Raised when a session is not found in the database."""
    
    def __init__(self, session_id: str):
        self.session_id = session_id
        super().__init__(f"Session not found: {session_id}")


class SessionExpiredError(Exception):
    """Raised when a session has expired."""
    
    def __init__(self, session_id: str, expired_at: datetime):
        self.session_id = session_id
        self.expired_at = expired_at
        super().__init__(f"Session expired: {session_id} at {expired_at.isoformat()}")


# ============================================================
# Data Models
# ============================================================

class SessionMetadata(BaseModel):
    """Metadata associated with a session.
    
    Attributes:
        ip_address: Client IP address
        user_agent: Client user agent string
        device_id: Optional device identifier
        location: Optional location information
    """
    ip_address: Optional[str] = Field(default=None, description="Client IP address")
    user_agent: Optional[str] = Field(default=None, description="Client user agent")
    device_id: Optional[str] = Field(default=None, description="Device identifier")
    location: Optional[Dict[str, str]] = Field(
        default=None, 
        description="Location info (country, region, city)"
    )
    
    class Config:
        extra = "allow"  # Allow additional fields


class Session(BaseModel):
    """Represents a user session.
    
    Attributes:
        session_id: Unique session identifier (UUID)
        user_id: User's unique identifier from Cognito (sub)
        email: User's email address
        name: User's display name
        created_at: Timestamp of session creation
        last_accessed_at: Timestamp of last activity
        expires_at: Unix timestamp for TTL expiration
        metadata: Additional session metadata
    """
    session_id: str = Field(..., description="Unique session identifier")
    user_id: str = Field(..., description="User's unique identifier (Cognito sub)")
    email: str = Field(..., description="User's email address")
    name: str = Field(..., description="User's display name")
    created_at: datetime = Field(..., description="Session creation timestamp")
    last_accessed_at: datetime = Field(..., description="Last activity timestamp")
    expires_at: int = Field(..., description="Unix timestamp for TTL expiration")
    metadata: Optional[SessionMetadata] = Field(
        default=None, 
        description="Additional session metadata"
    )
    
    class Config:
        frozen = True  # Make immutable
    
    def is_expired(self) -> bool:
        """Check if the session has expired.
        
        Returns:
            True if the session has expired, False otherwise
        """
        current_time = int(datetime.now(timezone.utc).timestamp())
        return current_time >= self.expires_at
    
    def time_until_expiry(self) -> timedelta:
        """Get the time remaining until session expiry.
        
        Returns:
            Timedelta until expiry (negative if already expired)
        """
        current_time = datetime.now(timezone.utc)
        expiry_time = datetime.fromtimestamp(self.expires_at, tz=timezone.utc)
        return expiry_time - current_time
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert session to dictionary for API responses.
        
        Returns:
            Dictionary representation of the session
        """
        return {
            "sessionId": self.session_id,
            "userId": self.user_id,
            "email": self.email,
            "name": self.name,
            "createdAt": self.created_at.isoformat(),
            "lastAccessedAt": self.last_accessed_at.isoformat(),
            "expiresAt": self.expires_at,
            "metadata": self.metadata.model_dump() if self.metadata else None,
        }


# ============================================================
# Configuration
# ============================================================

@dataclass
class SessionConfig:
    """Configuration for session management.
    
    Attributes:
        table_name: DynamoDB table name for sessions
        session_duration_hours: Session duration in hours (default: 8)
        idle_timeout_minutes: Idle timeout in minutes (default: 60)
        region: AWS region for DynamoDB
        endpoint_url: Optional DynamoDB endpoint URL (for local development)
    """
    table_name: str = field(default_factory=lambda: os.getenv(
        "SESSION_TABLE_NAME", "chatbot-sessions"
    ))
    session_duration_hours: int = field(default_factory=lambda: int(os.getenv(
        "SESSION_DURATION_HOURS", "8"
    )))
    idle_timeout_minutes: int = field(default_factory=lambda: int(os.getenv(
        "SESSION_IDLE_TIMEOUT_MINUTES", "60"
    )))
    region: str = field(default_factory=lambda: os.getenv(
        "AWS_DEFAULT_REGION", "us-east-1"
    ))
    endpoint_url: Optional[str] = field(default_factory=lambda: os.getenv(
        "DYNAMODB_ENDPOINT_URL"
    ))
    
    @classmethod
    def from_env(cls) -> "SessionConfig":
        """Create configuration from environment variables.
        
        Environment variables:
            SESSION_TABLE_NAME: DynamoDB table name
            SESSION_DURATION_HOURS: Session duration in hours
            SESSION_IDLE_TIMEOUT_MINUTES: Idle timeout in minutes
            AWS_DEFAULT_REGION: AWS region
            DYNAMODB_ENDPOINT_URL: Optional endpoint URL for local dev
        """
        return cls()


# ============================================================
# Session Manager
# ============================================================

class SessionManager:
    """Manages user sessions with DynamoDB backend.
    
    This class provides CRUD operations for user sessions, including:
    - Session creation with automatic TTL
    - Session retrieval with expiration validation
    - Session activity tracking and TTL refresh
    - Session deletion
    
    Example:
        config = SessionConfig(table_name="my-sessions")
        manager = SessionManager(config=config)
        
        # Create a new session
        session = await manager.create_session(
            user_id="user-123",
            email="user@example.com",
            name="John Doe",
            metadata=SessionMetadata(ip_address="192.168.1.1")
        )
        
        # Get session by ID
        session = await manager.get_session(session.session_id)
        
        # Update activity (refresh TTL)
        await manager.update_session_activity(session.session_id)
        
        # Delete session (logout)
        await manager.delete_session(session.session_id)
    """
    
    def __init__(self, config: Optional[SessionConfig] = None):
        """Initialize the session manager.
        
        Args:
            config: Session configuration (uses defaults if not provided)
        """
        self.config = config or SessionConfig.from_env()
        self._dynamodb = None
        self._table = None
        
        logger.info(
            f"SessionManager initialized: table={self.config.table_name}, "
            f"duration={self.config.session_duration_hours}h, "
            f"idle_timeout={self.config.idle_timeout_minutes}m"
        )
    
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
    
    def _calculate_expiry(self) -> int:
        """Calculate session expiry timestamp.
        
        Returns:
            Unix timestamp for session expiry
        """
        expiry_time = datetime.now(timezone.utc) + timedelta(
            hours=self.config.session_duration_hours
        )
        return int(expiry_time.timestamp())
    
    def _calculate_idle_expiry(self) -> int:
        """Calculate idle timeout expiry timestamp.
        
        Returns:
            Unix timestamp for idle timeout expiry
        """
        expiry_time = datetime.now(timezone.utc) + timedelta(
            minutes=self.config.idle_timeout_minutes
        )
        return int(expiry_time.timestamp())
    
    async def create_session(
        self,
        user_id: str,
        email: str,
        name: str,
        metadata: Optional[SessionMetadata] = None
    ) -> Session:
        """Create a new session for a user.
        
        Args:
            user_id: User's unique identifier (Cognito sub)
            email: User's email address
            name: User's display name
            metadata: Optional session metadata
            
        Returns:
            The created Session object
            
        Raises:
            ClientError: If DynamoDB operation fails
        """
        session_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        expires_at = self._calculate_expiry()
        
        item = {
            "sessionId": session_id,
            "userId": user_id,
            "email": email,
            "name": name,
            "createdAt": now.isoformat(),
            "lastAccessedAt": now.isoformat(),
            "expiresAt": expires_at,
        }
        
        if metadata:
            item["metadata"] = metadata.model_dump(exclude_none=True)
        
        try:
            self.table.put_item(Item=item)
            
            logger.info(
                f"Session created: session_id={session_id}, user_id={user_id}, "
                f"email={email}, expires_at={expires_at}"
            )
            
            return Session(
                session_id=session_id,
                user_id=user_id,
                email=email,
                name=name,
                created_at=now,
                last_accessed_at=now,
                expires_at=expires_at,
                metadata=metadata
            )
            
        except ClientError as e:
            logger.error(
                f"Failed to create session: {e.response['Error']['Message']}",
                extra={"user_id": user_id, "email": email}
            )
            raise
    
    async def get_session(
        self, 
        session_id: str,
        validate_expiry: bool = True
    ) -> Session:
        """Retrieve a session by ID.
        
        Args:
            session_id: The session ID to retrieve
            validate_expiry: Whether to validate session expiry (default: True)
            
        Returns:
            The Session object
            
        Raises:
            SessionNotFoundError: If session doesn't exist
            SessionExpiredError: If session has expired (when validate_expiry=True)
            ClientError: If DynamoDB operation fails
        """
        try:
            response = self.table.get_item(
                Key={"sessionId": session_id}
            )
            
            item = response.get("Item")
            if not item:
                logger.warning(f"Session not found: {session_id}")
                raise SessionNotFoundError(session_id)
            
            # Parse metadata if present
            metadata = None
            if "metadata" in item:
                metadata = SessionMetadata(**item["metadata"])
            
            session = Session(
                session_id=item["sessionId"],
                user_id=item["userId"],
                email=item["email"],
                name=item["name"],
                created_at=datetime.fromisoformat(item["createdAt"]),
                last_accessed_at=datetime.fromisoformat(item["lastAccessedAt"]),
                expires_at=int(item["expiresAt"]),
                metadata=metadata
            )
            
            # Validate expiry if requested
            if validate_expiry and session.is_expired():
                logger.warning(
                    f"Session expired: session_id={session_id}, "
                    f"expired_at={session.expires_at}"
                )
                raise SessionExpiredError(
                    session_id, 
                    datetime.fromtimestamp(session.expires_at, tz=timezone.utc)
                )
            
            logger.debug(f"Session retrieved: session_id={session_id}")
            return session
            
        except ClientError as e:
            logger.error(
                f"Failed to get session: {e.response['Error']['Message']}",
                extra={"session_id": session_id}
            )
            raise
    
    async def get_sessions_by_user(self, user_id: str) -> list[Session]:
        """Retrieve all sessions for a user.
        
        Args:
            user_id: The user ID to retrieve sessions for
            
        Returns:
            List of Session objects for the user
            
        Raises:
            ClientError: If DynamoDB operation fails
        """
        try:
            # Use a GSI on userId if available, otherwise scan with filter
            response = self.table.scan(
                FilterExpression="userId = :uid",
                ExpressionAttributeValues={":uid": user_id}
            )
            
            sessions = []
            for item in response.get("Items", []):
                metadata = None
                if "metadata" in item:
                    metadata = SessionMetadata(**item["metadata"])
                
                session = Session(
                    session_id=item["sessionId"],
                    user_id=item["userId"],
                    email=item["email"],
                    name=item["name"],
                    created_at=datetime.fromisoformat(item["createdAt"]),
                    last_accessed_at=datetime.fromisoformat(item["lastAccessedAt"]),
                    expires_at=int(item["expiresAt"]),
                    metadata=metadata
                )
                
                # Only include non-expired sessions
                if not session.is_expired():
                    sessions.append(session)
            
            logger.debug(
                f"Retrieved {len(sessions)} sessions for user: {user_id}"
            )
            return sessions
            
        except ClientError as e:
            logger.error(
                f"Failed to get sessions by user: {e.response['Error']['Message']}",
                extra={"user_id": user_id}
            )
            raise
    
    async def update_session_activity(
        self, 
        session_id: str,
        extend_ttl: bool = True
    ) -> Session:
        """Update session activity timestamp.
        
        This method updates the lastAccessedAt timestamp and optionally
        extends the session TTL based on idle timeout configuration.
        
        Args:
            session_id: The session ID to update
            extend_ttl: Whether to extend TTL based on idle timeout
            
        Returns:
            The updated Session object
            
        Raises:
            SessionNotFoundError: If session doesn't exist
            SessionExpiredError: If session has expired
            ClientError: If DynamoDB operation fails
        """
        # First, get the session to validate it exists and isn't expired
        session = await self.get_session(session_id, validate_expiry=True)
        
        now = datetime.now(timezone.utc)
        
        # Calculate new expiry based on idle timeout
        update_expression = "SET lastAccessedAt = :now"
        expression_values = {":now": now.isoformat()}
        
        new_expires_at = session.expires_at
        if extend_ttl:
            # Extend TTL by idle timeout, but don't exceed original session duration
            idle_expiry = self._calculate_idle_expiry()
            max_expiry = int(
                (session.created_at + timedelta(
                    hours=self.config.session_duration_hours
                )).timestamp()
            )
            new_expires_at = min(idle_expiry, max_expiry)
            
            update_expression += ", expiresAt = :exp"
            expression_values[":exp"] = new_expires_at
        
        try:
            self.table.update_item(
                Key={"sessionId": session_id},
                UpdateExpression=update_expression,
                ExpressionAttributeValues=expression_values
            )
            
            logger.debug(
                f"Session activity updated: session_id={session_id}, "
                f"new_expires_at={new_expires_at}"
            )
            
            # Return updated session
            return Session(
                session_id=session.session_id,
                user_id=session.user_id,
                email=session.email,
                name=session.name,
                created_at=session.created_at,
                last_accessed_at=now,
                expires_at=new_expires_at,
                metadata=session.metadata
            )
            
        except ClientError as e:
            logger.error(
                f"Failed to update session activity: {e.response['Error']['Message']}",
                extra={"session_id": session_id}
            )
            raise
    
    async def update_session_metadata(
        self,
        session_id: str,
        metadata: SessionMetadata
    ) -> Session:
        """Update session metadata.
        
        Args:
            session_id: The session ID to update
            metadata: New metadata to set
            
        Returns:
            The updated Session object
            
        Raises:
            SessionNotFoundError: If session doesn't exist
            SessionExpiredError: If session has expired
            ClientError: If DynamoDB operation fails
        """
        # First, get the session to validate it exists and isn't expired
        session = await self.get_session(session_id, validate_expiry=True)
        
        try:
            self.table.update_item(
                Key={"sessionId": session_id},
                UpdateExpression="SET metadata = :meta",
                ExpressionAttributeValues={
                    ":meta": metadata.model_dump(exclude_none=True)
                }
            )
            
            logger.debug(f"Session metadata updated: session_id={session_id}")
            
            # Return updated session
            return Session(
                session_id=session.session_id,
                user_id=session.user_id,
                email=session.email,
                name=session.name,
                created_at=session.created_at,
                last_accessed_at=session.last_accessed_at,
                expires_at=session.expires_at,
                metadata=metadata
            )
            
        except ClientError as e:
            logger.error(
                f"Failed to update session metadata: {e.response['Error']['Message']}",
                extra={"session_id": session_id}
            )
            raise
    
    async def delete_session(self, session_id: str) -> bool:
        """Delete a session (logout).
        
        Args:
            session_id: The session ID to delete
            
        Returns:
            True if session was deleted, False if it didn't exist
            
        Raises:
            ClientError: If DynamoDB operation fails
        """
        try:
            response = self.table.delete_item(
                Key={"sessionId": session_id},
                ReturnValues="ALL_OLD"
            )
            
            deleted = "Attributes" in response
            if deleted:
                logger.info(f"Session deleted: session_id={session_id}")
            else:
                logger.warning(f"Session not found for deletion: {session_id}")
            
            return deleted
            
        except ClientError as e:
            logger.error(
                f"Failed to delete session: {e.response['Error']['Message']}",
                extra={"session_id": session_id}
            )
            raise
    
    async def delete_user_sessions(self, user_id: str) -> int:
        """Delete all sessions for a user.
        
        Args:
            user_id: The user ID to delete sessions for
            
        Returns:
            Number of sessions deleted
            
        Raises:
            ClientError: If DynamoDB operation fails
        """
        sessions = await self.get_sessions_by_user(user_id)
        deleted_count = 0
        
        for session in sessions:
            if await self.delete_session(session.session_id):
                deleted_count += 1
        
        logger.info(
            f"Deleted {deleted_count} sessions for user: {user_id}"
        )
        return deleted_count
    
    async def cleanup_expired_sessions(self) -> int:
        """Manually cleanup expired sessions.
        
        Note: DynamoDB TTL handles automatic cleanup, but this method
        can be used for immediate cleanup if needed.
        
        Returns:
            Number of sessions cleaned up
            
        Raises:
            ClientError: If DynamoDB operation fails
        """
        current_time = int(datetime.now(timezone.utc).timestamp())
        
        try:
            # Scan for expired sessions
            response = self.table.scan(
                FilterExpression="expiresAt < :now",
                ExpressionAttributeValues={":now": current_time}
            )
            
            deleted_count = 0
            for item in response.get("Items", []):
                if await self.delete_session(item["sessionId"]):
                    deleted_count += 1
            
            logger.info(f"Cleaned up {deleted_count} expired sessions")
            return deleted_count
            
        except ClientError as e:
            logger.error(
                f"Failed to cleanup expired sessions: {e.response['Error']['Message']}"
            )
            raise
