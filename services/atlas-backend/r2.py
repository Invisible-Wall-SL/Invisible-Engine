"""R2 (S3-compatible) helpers via boto3."""
from __future__ import annotations

import os

import boto3


def _client():
    return boto3.client(
        "s3",
        region_name="auto",
        endpoint_url=os.environ["R2_ENDPOINT"],
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
    )


def put(key: str, body: bytes, content_type: str = "application/octet-stream") -> None:
    _client().put_object(
        Bucket=os.environ["R2_BUCKET"], Key=key, Body=body, ContentType=content_type
    )


def get(key: str) -> bytes:
    return _client().get_object(Bucket=os.environ["R2_BUCKET"], Key=key)["Body"].read()
