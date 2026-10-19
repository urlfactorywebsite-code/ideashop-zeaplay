"""Isolated multi-process integration app; never used by production entry points."""
import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI

from backend.app.chat.router import router as chat_router
from backend.app.chat import realtime as chat_events
from backend.app.routers.tasks import router as tasks_router
from backend.app.services import task_events
from backend.app.realtime import transport
from backend.app.observability import RealtimeMetricsMiddleware
from backend.app.ws import chat, tasks, ticket_chat
from backend.app.routers.auth import router as auth_router
from backend.tests.load_isolation import install as install_load_isolation


@asynccontextmanager
async def lifespan(app):
    loop = asyncio.get_running_loop()
    chat_events.start_chat_event_listener(loop=loop, handler=chat.manager.dispatch_remote_event, on_gap=chat.manager.close_all)
    task_events.start_task_event_listener(loop=loop, handler=tasks.broadcast_task_event, on_gap=tasks.manager.close_all)
    transport.start("ticket", loop, ticket_chat.manager.dispatch, ticket_chat.manager.close_all)
    yield
    await chat_events.stop_chat_event_listener()
    await task_events.stop_task_event_listener()
    await transport.stop("ticket")
    await chat.manager.close_all()
    await tasks.manager.close_all()
    await ticket_chat.manager.close_all()


app = FastAPI(lifespan=lifespan)
app.add_middleware(RealtimeMetricsMiddleware)
for router in (chat_router, tasks_router, auth_router, chat.router, tasks.router, ticket_chat.router):
    app.include_router(router, prefix="/api")
install_load_isolation(app)


@app.get("/health")
async def health():
    return transport.health()
