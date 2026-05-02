from fastapi import FastAPI

from src.app.modules.discovery.router import router as discovery_router
from src.app.modules.devices.router import router as devices_router
from src.app.modules.entities.router import router as entities_router
from src.app.modules.inbox.router import router as inbox_router
from src.app.modules.integrations.router import providers_router, router as integrations_router
from src.app.modules.rooms.router import router as rooms_router

app = FastAPI()

app.include_router(discovery_router, prefix="/discovery", tags=["Discovery"])
app.include_router(devices_router, prefix="/devices", tags=["Devices"])
app.include_router(entities_router, prefix="/entities", tags=["Entities"])
app.include_router(inbox_router, prefix="/inbox", tags=["Inbox"])
app.include_router(providers_router, prefix="/integration-providers", tags=["Integration Providers"])
app.include_router(integrations_router, prefix="/integrations", tags=["Integrations"])
app.include_router(rooms_router, prefix="/rooms", tags=["Rooms"])

@app.get("/health")
def health_check():
    return {"status": "ok"}
