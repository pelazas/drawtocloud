import os
from supabase import create_client, Client

supabase: Client = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SECRET_KEY"],  # service key for server-side ops
)
