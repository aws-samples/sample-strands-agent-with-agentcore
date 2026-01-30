# Fix: Backend ne démarre pas en local - 28 janvier 2025

## Problème

Lors du démarrage en local avec `./start.sh`, le frontend ne pouvait pas se connecter au backend AgentCore:

```
[AgentCore] ❌ Failed to invoke Runtime: TypeError: fetch failed
Error: connect ECONNREFUSED ::1:8080
```

## Cause

Le module Python `opentelemetry` n'était pas installé dans l'environnement virtuel, causant une erreur au démarrage du backend:

```python
ModuleNotFoundError: No module named 'opentelemetry'
```

Le backend se terminait immédiatement sans écouter sur le port 8080.

## Solution

Installation du package manquant:

```bash
cd chatbot-app/agentcore
source venv/bin/activate
pip install aws-opentelemetry-distro
```

## Vérification

Après l'installation, redémarrez les services:

```bash
cd chatbot-app
./start.sh
```

Vérifiez que le backend écoute sur le port 8080:

```bash
lsof -i :8080 | grep LISTEN
```

Vous devriez voir:
```
python  <PID> <user>  <fd>u  IPv4  <device>  0t0  TCP localhost:8080 (LISTEN)
```

## Test

1. Ouvrez http://localhost:3000
2. Envoyez un message de test
3. Le backend devrait répondre sans erreur `ECONNREFUSED`

## Note importante

Si vous rencontrez à nouveau ce problème après avoir mis à jour `requirements.txt`, exécutez:

```bash
cd chatbot-app/agentcore
source venv/bin/activate
pip install -r requirements.txt
```

Cela garantit que toutes les dépendances sont installées.

## Logs

Les logs du backend sont disponibles dans:
```
chatbot-app/agentcore.log
```

Pour surveiller les logs en temps réel:
```bash
tail -f chatbot-app/agentcore.log
```
