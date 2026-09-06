# Multiplayer publiceren op Google Cloud Run

Deze branch bevat de multiplayerwebsite en de server. De bestaande GitHub Pages-site op
`presidenten.fremeijer.net` wordt door deze deployment niet aangepast.

## Benodigde accounts

- Een Google-account.
- Een Google Cloud-project met een gekoppeld factureringsaccount.
- Geen apart Cloud Run-account.
- Geen apart Firebase-account. Firestore hoort bij hetzelfde Google Cloud-project. Het
  project kan optioneel aan de Firebase-console worden toegevoegd om Firestore daar te beheren.

## 1. Project aanmaken

1. Open <https://console.cloud.google.com/projectcreate>.
2. Maak een project aan, bijvoorbeeld `Presidenten multiplayer`.
3. Noteer het unieke project-ID. In de voorbeelden heet dit `JOUW_PROJECT_ID`.
4. Koppel onder **Billing / Facturering** een factureringsaccount.
5. Stel een budgetwaarschuwing in, bijvoorbeeld op EUR 5 per maand. Een waarschuwing is geen harde kostenlimiet.

## 2. Firestore aanmaken

1. Open in hetzelfde project **Firestore**.
2. Kies **Create database**.
3. Kies **Native mode** en bij voorkeur regio `europe-west4` (Nederland).
4. Kies productiebeveiliging. De browsers gebruiken Firestore niet rechtstreeks; alleen Cloud Run krijgt toegang.

De meegeleverde `firestore.rules` weigert alle rechtstreekse browsertoegang. Deze regels kunnen
later via de Firebase-console of Firebase CLI worden gepubliceerd.

## 3. Google Cloud voorbereiden

Open Cloud Shell in de Google Cloud-console en voer uit:

```sh
gcloud config set project JOUW_PROJECT_ID
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com firestore.googleapis.com
gcloud iam service-accounts create presidenten-server --display-name="Presidenten multiplayer server"
gcloud projects add-iam-policy-binding JOUW_PROJECT_ID \
  --member="serviceAccount:presidenten-server@JOUW_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/datastore.user"
```

Vervang beide keren `JOUW_PROJECT_ID` door het echte project-ID.

## 4. Broncode ophalen

De cloudversie staat op de branch `codex/multiplayer-local`:

```sh
git clone --branch codex/multiplayer-local https://github.com/davidfrem/presidenten.git
cd presidenten
```

## 5. Deployen

```sh
gcloud run deploy presidenten-multiplayer \
  --source . \
  --region europe-west4 \
  --allow-unauthenticated \
  --service-account presidenten-server@JOUW_PROJECT_ID.iam.gserviceaccount.com \
  --timeout 3600 \
  --max-instances 1 \
  --min-instances 0 \
  --memory 512Mi \
  --cpu 1 \
  --session-affinity \
  '--set-env-vars=^@^ROOM_TTL_HOURS=24@FIRESTORE_DATABASE_ID=presidenten@ALLOWED_ORIGINS=https://presidenten.fremeijer.net,https://samen.presidenten.fremeijer.net'
```

Cloud Run toont daarna een HTTPS-adres dat eindigt op `run.app`. Open dat adres op meerdere
iPads en test eerst een volledig spel. De client herstelt de WebSocketverbinding automatisch.

`--max-instances 1` is bewust gekozen: de huidige realtime uitzendingen leven binnen één
serverinstance. Firestore bewaart wel alle kamerstatus, waardoor een serverherstart kan worden
hersteld. Voor grotere aantallen gelijktijdige spellen is later een gedeeld pub/sub-kanaal nodig.

### Deployen vanaf deze Mac

De werkende configuratie op de ontwikkel-Mac is:

- Google Cloud-project: `presidenten-multiplayer`
- account: `davidfre@gmail.com`
- regio: `europe-west4`
- Cloud Run-service: `presidenten-multiplayer`
- serviceaccount: `presidenten-server@presidenten-multiplayer.iam.gserviceaccount.com`
- Firestore-database-ID: `presidenten`
- Google Cloud SDK: `/private/tmp/google-cloud-sdk/bin/gcloud`
- geschikte Python-runtime:
  `/Users/davidfremeijer/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3`

`gcloud` staat momenteel niet in `PATH`. Stel daarom voor ieder commando `CLOUDSDK_PYTHON`
in. Dit voorkomt tevens fouten doordat de standaard-Python op deze Mac te oud is voor de SDK.

Controleer vóór een deployment de actieve identiteit en het project:

```sh
CLOUDSDK_PYTHON=/Users/davidfremeijer/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
  /private/tmp/google-cloud-sdk/bin/gcloud config list --format=json
```

Deploy vervolgens vanuit de hoofdmap van deze repository:

```sh
CLOUDSDK_PYTHON=/Users/davidfremeijer/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
  /private/tmp/google-cloud-sdk/bin/gcloud run deploy presidenten-multiplayer \
  --source . \
  --region europe-west4 \
  --allow-unauthenticated \
  --service-account presidenten-server@presidenten-multiplayer.iam.gserviceaccount.com \
  --timeout 3600 \
  --max-instances 1 \
  --min-instances 0 \
  --memory 512Mi \
  --cpu 1 \
  --session-affinity \
  '--set-env-vars=^@^ROOM_TTL_HOURS=24@FIRESTORE_DATABASE_ID=presidenten@ALLOWED_ORIGINS=https://presidenten.fremeijer.net,https://samen.presidenten.fremeijer.net' \
  --project presidenten-multiplayer
```

De afwijkende `^@^`-notatie is nodig omdat `ALLOWED_ORIGINS` zelf een komma bevat. Zonder
deze delimiter interpreteert `gcloud` het tweede domein ten onrechte als een nieuwe variabele.

Controleer na afloop de gepubliceerde versie op zowel het Cloud Run-adres als het eigen domein:

```sh
curl -s https://presidenten-multiplayer-920922567743.europe-west4.run.app/version.js
curl -s https://samen.presidenten.fremeijer.net/version.js
```

Beide antwoorden moeten dezelfde `APP_VERSION` tonen als lokaal in `version.js`. Controleer
bij twijfel ook de actieve revisie en verkeersverdeling:

```sh
CLOUDSDK_PYTHON=/Users/davidfremeijer/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
  /private/tmp/google-cloud-sdk/bin/gcloud run services describe presidenten-multiplayer \
  --region europe-west4 \
  --project presidenten-multiplayer \
  --format='yaml(status.latestReadyRevisionName,status.traffic,status.url)'
```

De SDK-map onder `/private/tmp` kan na een herstart of opruimactie verdwenen zijn. Zoek of
installeer de SDK dan opnieuw en werk het pad in deze handleiding bij. Inloggen kan zo nodig met
`gcloud auth login`; controleer daarna opnieuw account en project voordat je deployt.

## 6. Firestore TTL inschakelen

Stel in Firestore een TTL-beleid in voor collectie `multiplayerRooms` en veld `expiresAt`.
Hiermee verwijdert Google oude spelkamers automatisch. De server beschouwt verlopen kamers ook
zonder TTL-beleid al als ongeldig.

## 7. Eigen subdomein

Doe dit pas nadat het `run.app`-adres goed is getest.

```sh
gcloud beta run domain-mappings create \
  --service presidenten-multiplayer \
  --domain samen.presidenten.fremeijer.net \
  --region europe-west4
```

Cloud Run geeft vervolgens DNS-records. Voeg die toe bij de DNS-provider van `fremeijer.net`.
De uitgifte van het HTTPS-certificaat kan enige tijd duren.

## Lokaal blijven testen

Zonder Cloud Run-variabelen gebruikt de server automatisch geheugenopslag:

```sh
npm install
npm start
```

Met de Firestore Emulator kan de cloudopslag lokaal worden getest door
`FIRESTORE_EMULATOR_HOST`, `FIRESTORE_PROJECT_ID` en eventueel
`FIRESTORE_DATABASE_ID` in te stellen.
