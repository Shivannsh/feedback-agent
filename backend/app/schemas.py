from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

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


class SlideEvent(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    type: Literal["start", "slide", "pause", "resume", "finish"]
    slide: int = Field(ge=1, le=20)
    time: float = Field(ge=0, le=900.1)
    wall_time: float = Field(ge=0, le=14400)


class PresentationInput(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    deck_id: str = Field(pattern=r"^[a-f0-9-]{36}$")
    recording_id: str = Field(pattern=r"^[a-f0-9-]{36}$")
    duration: float = Field(ge=1, le=900.1)
    events: list[SlideEvent] = Field(min_length=2, max_length=500)

    @model_validator(mode="after")
    def validate_timeline(self):
        if self.events[0].type != "start" or self.events[0].time != 0:
            raise ValueError("The presentation must start at recording time zero.")
        if (
            self.events[-1].type != "finish"
            or abs(self.events[-1].time - self.duration) > 0.05
        ):
            raise ValueError("The presentation must end at the recording duration.")
        active = True
        previous = self.events[0]
        for index, event in enumerate(self.events[1:], 1):
            if event.time < previous.time or event.wall_time < previous.wall_time:
                raise ValueError("Timeline events must be in time order.")
            if event.time > self.duration + 0.05:
                raise ValueError("A slide event lies outside the recording.")
            if event.type == "start" or (
                event.type == "finish" and index != len(self.events) - 1
            ):
                raise ValueError("Only one start and finish are permitted.")
            if not active and abs(event.time - previous.time) > 0.05:
                raise ValueError("Recording time must stay still during a pause.")
            if event.type == "pause":
                if not active:
                    raise ValueError("The recording is already paused.")
                active = False
            elif event.type == "resume":
                if active:
                    raise ValueError("The recording is already running.")
                active = True
            if event.type != "slide" and event.slide != previous.slide:
                raise ValueError("A slide change requires its own slide event.")
            previous = event
        return self


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
