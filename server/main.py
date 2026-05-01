from fastapi import FastAPI

from src.app.modules.discovery.router import router as discovery_router
from src.app.modules.devices.router import router as devices_router

app = FastAPI()

app.include_router(discovery_router, prefix="/discovery", tags=["Discovery"])
app.include_router(devices_router, prefix="/devices", tags=["Devices"])

@app.get("/health")
def health_check():
    return {"status": "ok"}
