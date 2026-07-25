from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ProtocolModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class ActivityIdentity(ProtocolModel):
    name: str
    version: int


class ClaimedActivity(ProtocolModel):
    protocol_version: int = Field(alias="protocolVersion")
    activity_id: str = Field(alias="activityId")
    activity_type: str = Field(alias="activityType")
    activity_version: int = Field(alias="activityVersion")
    task_queue: str = Field(alias="taskQueue")
    attempt: int
    lease_token: str = Field(alias="leaseToken")
    lease_expires_at: float = Field(alias="leaseExpiresAt")
    attempt_deadline: float = Field(alias="attemptDeadline")
    schedule_deadline: float = Field(alias="scheduleDeadline")
    input: Any
    artifact_scope_id: str | None = Field(default=None, alias="artifactScopeId")
    artifact_slots: list[str] = Field(default_factory=list, alias="artifactSlots")


class RenewalResponse(ProtocolModel):
    accepted: bool
    cancel_requested: bool = Field(alias="cancelRequested")
    lease_expires_at: float | None = Field(default=None, alias="leaseExpiresAt")


class TerminalResponse(ProtocolModel):
    accepted: bool
    duplicate: bool


class FailureResponse(TerminalResponse):
    retrying: bool
