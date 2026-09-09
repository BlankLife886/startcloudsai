"""Verify real OpenAI SDK HTTP serialization without network or paid requests.

Run with an environment containing openai and its HTTP client dependency:
    python examples/open-api/test_openai_sdk.py
"""

import base64
import io
import json
import unittest
from email import policy
from email.parser import BytesParser

import openai

# Follow the installed SDK's actual transport: SDK 3.x uses httpx2;
# older releases use httpx. Only the HTTP transport is replaced in these tests.
try:
    from openai._base_client import httpx2 as httpx
except ImportError:
    import httpx

from openai_images import image_extension


MODEL_ID = "sdk-test-image-model"
TASK_ID = "sdk-test-task-id"
PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNoDPj/HwAF9gLQWK3ToAAAAABJRU5ErkJggg=="
PNG = base64.b64decode(PNG_B64, validate=True)
MODEL = {"id": MODEL_ID, "object": "model", "created": 0, "owned_by": "starcloudsai"}
IMAGE_RESPONSE = {"created": 1788912000, "data": [{"b64_json": PNG_B64}]}


def upload_image(filename):
    image = io.BytesIO(PNG)
    image.name = filename
    return image


def multipart_parts(request):
    """Parse the SDK's actual wire bytes, including its generated boundary."""
    content_type = request.headers["content-type"]
    message = BytesParser(policy=policy.default).parsebytes(
        b"Content-Type: " + content_type.encode("ascii")
        + b"\r\nMIME-Version: 1.0\r\n\r\n" + request.content
    )
    if not message.is_multipart():
        raise AssertionError("Images edit must use multipart/form-data")
    return [
        {
            "name": part.get_param("name", header="content-disposition"),
            "filename": part.get_filename(),
            "content_type": part.get_content_type(),
            "data": part.get_payload(decode=True),
        }
        for part in message.iter_parts()
    ]


class OpenAIImagesSDKContractTest(unittest.TestCase):
    def setUp(self):
        self.requests = []

    def client(self, respond, max_retries=0):
        def transport(request):
            # MockTransport always intercepts this request; no DNS or socket is used.
            request.read()
            self.requests.append(request)
            self.assertEqual(request.url.host, "sdk-mock.invalid")
            return respond(request)

        client = openai.OpenAI(
            api_key="test-only-invalid-key",
            base_url="https://sdk-mock.invalid/v1",
            timeout=1.0,
            max_retries=max_retries,
            http_client=httpx.Client(transport=httpx.MockTransport(transport), trust_env=False),
        )
        self.addCleanup(client.close)
        return client

    def image_client(self):
        return self.client(lambda request: httpx.Response(
            200,
            json=IMAGE_RESPONSE,
            headers={"X-Task-ID": TASK_ID},
        ))

    def test_models_list_and_retrieve_parse_standard_model_objects(self):
        def respond(request):
            if request.url.path == "/v1/models":
                return httpx.Response(200, json={"object": "list", "data": [MODEL]})
            self.assertEqual(request.url.path, "/v1/models/" + MODEL_ID)
            return httpx.Response(200, json=MODEL)

        client = self.client(respond)
        models = client.models.list()
        model = client.models.retrieve(MODEL_ID)
        self.assertEqual(models.object, "list")
        self.assertEqual([entry.id for entry in models.data], [MODEL_ID])
        self.assertEqual(model.object, "model")
        self.assertEqual(model.owned_by, "starcloudsai")
        self.assertEqual(model.created, 0)
        self.assertEqual([request.method for request in self.requests], ["GET", "GET"])
        self.assertEqual(self.requests[0].headers["authorization"], "Bearer test-only-invalid-key")

    def test_generate_sends_flat_json_and_decodes_the_result(self):
        result = self.image_client().images.generate(
            model=MODEL_ID,
            prompt="窗边的橘猫",
            n=1,
            size="auto",
            quality="auto",
            response_format="b64_json",
            extra_headers={"Idempotency-Key": "sdk-generation-001"},
        )
        request = self.requests[0]
        self.assertEqual(request.method, "POST")
        self.assertEqual(request.url.path, "/v1/images/generations")
        self.assertEqual(request.headers["content-type"], "application/json")
        self.assertEqual(request.headers["idempotency-key"], "sdk-generation-001")
        self.assertEqual(json.loads(request.content), {
            "model": MODEL_ID,
            "prompt": "窗边的橘猫",
            "n": 1,
            "size": "auto",
            "quality": "auto",
            "response_format": "b64_json",
        })
        decoded = base64.b64decode(result.data[0].b64_json, validate=True)
        self.assertEqual(image_extension(decoded), ".png")
        self.assertEqual(decoded, PNG)
        self.assertEqual(result.created, 1788912000)

    def test_raw_generate_preserves_task_id_and_the_parsed_image(self):
        raw = self.image_client().images.with_raw_response.generate(
            model=MODEL_ID,
            prompt="raw response test",
            response_format="b64_json",
            extra_headers={"Idempotency-Key": "sdk-raw-001"},
        )
        self.assertEqual(raw.status_code, 200)
        self.assertEqual(raw.headers.get("x-task-id"), TASK_ID)
        self.assertEqual(raw.parse().data[0].b64_json, PNG_B64)
        self.assertEqual(self.requests[0].headers["idempotency-key"], "sdk-raw-001")

    def assert_edit_fields(self, request, parts):
        self.assertEqual(request.method, "POST")
        self.assertEqual(request.url.path, "/v1/images/edits")
        self.assertTrue(request.headers["content-type"].startswith("multipart/form-data; boundary="))
        fields = {part["name"]: part["data"].decode("utf-8") for part in parts if part["filename"] is None}
        self.assertEqual(fields, {
            "model": MODEL_ID,
            "prompt": "将背景改为浅蓝色",
            "n": "1",
            "size": "auto",
            "quality": "auto",
            "response_format": "b64_json",
        })

    def edit(self, image):
        return self.image_client().images.edit(
            model=MODEL_ID,
            image=image,
            prompt="将背景改为浅蓝色",
            n=1,
            size="auto",
            quality="auto",
            response_format="b64_json",
            extra_headers={"Idempotency-Key": "sdk-edit-001"},
        )

    def test_edit_single_image_uses_the_image_multipart_field(self):
        with upload_image("reference.png") as reference:
            result = self.edit(reference)
        request = self.requests[0]
        parts = multipart_parts(request)
        self.assert_edit_fields(request, parts)
        files = [part for part in parts if part["filename"] is not None]
        self.assertEqual(len(files), 1)
        self.assertEqual(files[0]["name"], "image")
        self.assertEqual(files[0]["filename"], "reference.png")
        self.assertEqual(files[0]["content_type"], "image/png")
        self.assertEqual(files[0]["data"], PNG)
        self.assertEqual(result.data[0].b64_json, PNG_B64)

    def test_edit_multiple_images_repeats_image_array_multipart_fields(self):
        with upload_image("front.png") as front, upload_image("side.png") as side:
            self.edit([front, side])
        request = self.requests[0]
        parts = multipart_parts(request)
        self.assert_edit_fields(request, parts)
        files = [part for part in parts if part["filename"] is not None]
        self.assertEqual([part["name"] for part in files], ["image[]", "image[]"])
        self.assertEqual([part["filename"] for part in files], ["front.png", "side.png"])
        self.assertTrue(all(part["content_type"] == "image/png" and part["data"] == PNG for part in files))
        self.assertEqual(request.headers["idempotency-key"], "sdk-edit-001")

    def test_400_error_envelope_maps_to_sdk_error_fields(self):
        error_body = {"error": {
            "message": "style is not supported",
            "type": "invalid_request_error",
            "param": "style",
            "code": "unsupported_parameter",
        }}
        client = self.client(lambda request: httpx.Response(400, json=error_body))
        with self.assertRaises(openai.BadRequestError) as caught:
            client.images.generate(model=MODEL_ID, prompt="test", style="vivid")
        error = caught.exception
        self.assertEqual(error.status_code, 400)
        self.assertEqual(error.code, "unsupported_parameter")
        self.assertEqual(error.param, "style")
        self.assertEqual(error.type, "invalid_request_error")
        self.assertIn("style is not supported", error.message)
        self.assertEqual(len(self.requests), 1)

    def test_should_retry_false_prevents_sdk_automatic_500_retry(self):
        error_body = {"error": {
            "message": "The created image task failed",
            "type": "server_error",
            "param": None,
            "code": "task_failed",
        }}
        client = self.client(lambda request: httpx.Response(
            500,
            json=error_body,
            headers={"X-Should-Retry": "false", "X-Task-ID": TASK_ID},
        ), max_retries=2)
        with self.assertRaises(openai.InternalServerError) as caught:
            client.images.generate(
                model=MODEL_ID,
                prompt="test",
                extra_headers={"Idempotency-Key": "sdk-failure-001"},
            )
        self.assertEqual(client.max_retries, 2)
        self.assertEqual(len(self.requests), 1, "SDK must not replay a completed failed task")
        self.assertEqual(caught.exception.response.headers["x-task-id"], TASK_ID)
        self.assertEqual(caught.exception.code, "task_failed")


if __name__ == "__main__":
    print(f"OpenAI SDK {openai.__version__}; {httpx.__name__} {httpx.__version__}; MockTransport only", flush=True)
    unittest.main(verbosity=2)
