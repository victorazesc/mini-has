from pydantic import BaseModel
from datetime import datetime

class Device(BaseModel):
    id: str
    name: str
    type: str
    provider: str
    active: bool
    status: str
    room: str
    created_at: datetime
    updated_at: datetime