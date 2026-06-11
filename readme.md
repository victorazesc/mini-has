docker compose -f docker-compose.prod.yml up -d --build --force-recreate

Os modelos 3D enviados pelo client ficam no volume `client_floor_models`. Em redeploys, nao use `docker compose down -v` se quiser preservar os uploads.
