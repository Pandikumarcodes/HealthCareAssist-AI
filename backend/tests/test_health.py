import pytest

from app import create_app


@pytest.fixture()
def app():
    return create_app({"TESTING": True})


@pytest.fixture()
def client(app):
    return app.test_client()


def test_application_factory_uses_test_configuration(app):
    assert app.config["TESTING"] is True
    assert app.config["DEBUG"] is False


def test_health_check_returns_service_metadata(client):

    response = client.get("/api/health")

    assert response.status_code == 200

    assert response.is_json
    assert response.get_json() == {
        "status": "healthy",
        "service": "HealthCareAssist AI",
        "version": "1.0.0",
    }


def test_unknown_endpoint_returns_not_found(client):
    response = client.get("/api/unknown")

    assert response.status_code == 404
