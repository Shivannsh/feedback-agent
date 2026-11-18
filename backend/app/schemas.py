from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

AUDIENCES = {
    "general": "A general business listener. Familiar with everyday business concepts. Hearing about this company for the first time.",
    "school": "A school principal familiar with classroom teaching, teacher workloads, and school purchasing. Limited familiarity with AI video production. Hearing about this company for the first time.",
    "maritime": "A maritime training manager familiar with technical instruction and training delivery. Hearing about this company for the first time.",
}
Audience = Literal["general", "school", "maritime"]


class CreateAttempt(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=120)
    audience: Audience = "general"
    transcript: str = Field(min_length=30, max_length=40000)
    parent_id: str | None = None


class IntentInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    takeaways: list[str] = Field(min_length=1, max_length=5)

    @field_validator("takeaways")
    @classmethod
    def validate_takeaways(cls, values: list[str]) -> list[str]:
        cleaned = [value.strip() for value in values]
        if any(not value or len(value) > 600 for value in cleaned):
            raise ValueError("Each takeaway must contain between 1 and 600 characters.")
        return cleaned


class Belief(BaseModel):
    topic: str
    interpretation: str
    basis: Literal["stated", "inferred", "unclear"]
    source_segment_ids: list[str]


class Assumption(BaseModel):
    assumption: str
    trigger_segment_ids: list[str]


class Uncertainty(BaseModel):
    question: str
    possible_interpretations: list[str]


class ListenerReport(BaseModel):
    mental_picture: str
    main_takeaway: str
    beliefs: list[Belief]
    assumptions: list[Assumption]
    uncertainties: list[Uncertainty]
    first_question: str


class EvidenceAnnotation(BaseModel):
    belief_index: int
    assessment: Literal["supported", "inference", "unsupported", "ambiguous"]
    explanation: str
    source_segment_ids: list[str]


class NarrativeFlag(BaseModel):
    passage: str
    explanation: str
    source_segment_ids: list[str]


class EvidenceReview(BaseModel):
    annotations: list[EvidenceAnnotation]
    narrative_flags: list[NarrativeFlag]


class ComparisonItem(BaseModel):
    takeaway_index: int
    listener_interpretation: str
    alignment: Literal["understood", "partial", "missed", "different"]
    gap: str
    suggested_clarification: str
    source_segment_ids: list[str]


class ComparisonReport(BaseModel):
    items: list[ComparisonItem]
    priority_changes: list[str]
