"""seed app_settings defaults

Revision ID: 0002
Revises: 0001
Create Date: 2026-07-20

"""
import json

from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

DEFAULTS = {
    "task_prices": {"t2i": 20, "coloring": 30, "ui_design": 30, "model_sheet": 40, "game_art": 30, "puzzle": 10},
    "user_max_running_tasks": 3,
    "signup_bonus_cents": 100,
    "registration_enabled": True,
    "task_models": {"default": "gpt-image-2"},
}


def upgrade() -> None:
    for key, value in DEFAULTS.items():
        op.execute(
            sa.text(
                "INSERT INTO app_settings (key, value) VALUES (:key, cast(:value AS jsonb)) "
                "ON CONFLICT (key) DO NOTHING"
            ).bindparams(key=key, value=json.dumps(value))
        )


def downgrade() -> None:
    op.execute(
        sa.text("DELETE FROM app_settings WHERE key IN :keys").bindparams(
            sa.bindparam("keys", expanding=True, value=list(DEFAULTS.keys()))
        )
    )
