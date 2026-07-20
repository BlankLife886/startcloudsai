"""CLI：python -m app.cli create-admin --email x --password y"""
import argparse
import asyncio

from sqlalchemy import select

from app.db import SessionLocal
from app.models import User, Wallet
from app.services.security import hash_password


async def create_admin(email: str, password: str) -> None:
    email = email.lower().strip()
    async with SessionLocal() as db:
        user = await db.scalar(select(User).where(User.email == email))
        if user is None:
            user = User(
                email=email,
                username=email.split("@")[0],
                password_hash=hash_password(password),
                role="admin",
            )
            db.add(user)
            await db.flush()
            db.add(Wallet(user_id=user.id))
            action = "created"
        else:
            user.role = "admin"
            user.password_hash = hash_password(password)
            wallet = await db.get(Wallet, user.id)
            if wallet is None:
                db.add(Wallet(user_id=user.id))
            action = "promoted"
        await db.commit()
        print(f"admin {action}: {email} (id={user.id})")


def main() -> None:
    parser = argparse.ArgumentParser(prog="app.cli")
    subparsers = parser.add_subparsers(dest="command", required=True)
    admin_parser = subparsers.add_parser("create-admin", help="创建或提升管理员")
    admin_parser.add_argument("--email", required=True)
    admin_parser.add_argument("--password", required=True)
    args = parser.parse_args()

    if args.command == "create-admin":
        asyncio.run(create_admin(args.email, args.password))


if __name__ == "__main__":
    main()
