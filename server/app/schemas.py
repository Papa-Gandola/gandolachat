from datetime import datetime
from pydantic import BaseModel, EmailStr


class UserRegister(BaseModel):
    username: str
    email: EmailStr
    password: str


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: int
    username: str
    email: str
    avatar_url: str | None

    model_config = {"from_attributes": True}


class Token(BaseModel):
    access_token: str
    token_type: str
    user: UserOut


class MessageOut(BaseModel):
    id: int
    chat_id: int
    sender_id: int
    sender_username: str
    sender_avatar: str | None
    content: str | None
    file_url: str | None
    file_name: str | None
    is_edited: bool = False
    reply_to_id: int | None = None
    reply_to_username: str | None = None
    reply_to_content: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ChatOut(BaseModel):
    id: int
    name: str | None
    is_group: bool
    members: list[UserOut]
    last_message: MessageOut | None = None

    model_config = {"from_attributes": True}


class CreateGroupChat(BaseModel):
    name: str
    member_ids: list[int]


class AddMember(BaseModel):
    user_id: int
