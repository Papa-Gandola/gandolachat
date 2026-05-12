from datetime import datetime
from pydantic import BaseModel


class UserRegister(BaseModel):
    username: str
    password: str


class UserLogin(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: int
    username: str
    avatar_url: str | None
    status: str | None = None
    about: str | None = None
    grammar_errors: int = 0
    last_seen: datetime | None = None

    model_config = {"from_attributes": True}


class Token(BaseModel):
    access_token: str
    token_type: str
    user: UserOut


# Returned from /api/users/me. Backward-compat: pre-2.1.1 clients did
# `setUser(res.data)` and accessed `.username` directly. The new shape wraps
# the user under `.user` plus adds an access token for renewal. To keep BOTH
# old and new clients working, we flatten the UserOut fields onto the top
# level alongside the new wrapper fields, so old clients still see id/username
# at res.data.*, and new clients see res.data.user/access_token as well.
class MeOut(UserOut):
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
    reactions: list[dict] = []
    created_at: datetime
    media_group_id: str | None = None

    model_config = {"from_attributes": True}


class ChatOut(BaseModel):
    id: int
    name: str | None
    is_group: bool
    created_by: int | None = None
    members: list[UserOut]
    last_message: MessageOut | None = None
    allow_all_write: bool = True
    avatar_url: str | None = None
    description: str | None = None
    admin_ids: list[int] = []

    model_config = {"from_attributes": True}


class ChatStats(BaseModel):
    media_count: int
    link_count: int
    file_count: int


class UpdateChat(BaseModel):
    name: str | None = None
    description: str | None = None
    admin_ids: list[int] | None = None


class CreateGroupChat(BaseModel):
    name: str
    member_ids: list[int]
    allow_all_write: bool = True


class AddMember(BaseModel):
    user_id: int
