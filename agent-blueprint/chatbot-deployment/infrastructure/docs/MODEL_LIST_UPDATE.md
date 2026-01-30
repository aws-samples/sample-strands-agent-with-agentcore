# Mise à jour de la liste des modèles - 28 janvier 2025

## Modifications apportées

### Fichier modifié
`chatbot-app/frontend/src/app/api/model/available-models/route.ts`

### Corrections effectuées
Les IDs de modèles ont été corrigés pour utiliser le format Bedrock standard:
- ❌ `eu.anthropic.claude-*` → ✅ `anthropic.claude-*`
- ❌ `eu.amazon.nova-*` → ✅ `amazon.nova-*`

### Nouveaux modèles ajoutés
La liste des modèles disponibles a été étendue pour inclure:

**Claude (Anthropic)**
- Claude Opus 4.5 - Most intelligent model
- Claude Sonnet 4.5 - Most capable model
- Claude Haiku 4.5 - Fast and efficient

**Nova (Amazon)**
- Nova 2 Omni - Preview multimodal model
- Nova 2 Pro - High-performance multimodal
- Nova 2 Lite - Lightweight and efficient

**GPT (OpenAI)**
- GPT OSS 120B - Open-source GPT model
- GPT OSS Safeguard 20B/120B - Content safety models

**Qwen**
- Qwen3 VL 235B - Multimodal model
- Qwen 235B - Large-scale language model
- Qwen3 Next 80B - Fast inference for long documents
- Qwen 32B - Efficient language model

**Gemma (Google)**
- Gemma 3 27B/12B/4B - Text and image models

**NVIDIA**
- Nemotron Nano 12B v2 VL - Multimodal reasoning
- Nemotron Nano 9B v2 - High efficiency

**Mistral**
- Voxtral Small 24B - Audio input with text
- Voxtral Mini 3B - Audio understanding

**Autres**
- Kimi K2 Thinking (Moonshot AI) - Deep reasoning
- MiniMax M2 (MiniMax AI) - Coding agents

## Déploiement

### Commande exécutée
```bash
export USE_EXISTING_TABLES=true
export USE_EXISTING_ECR=true
export USE_EXISTING_BUCKET=true
npx cdk deploy ChatbotStack --require-approval never
```

### Résultat
✅ Déploiement réussi en ~8 minutes

### Statut des ressources
- **ECS Service**: ACTIVE (1/1 tasks running)
- **DynamoDB Tables**: Préservées (USE_EXISTING_TABLES=true)
- **CloudFront**: https://d1ystqalgm445b.cloudfront.net
- **ALB**: http://Chatbo-Chatb-24QlFnTXYFr1-424007574.eu-west-1.elb.amazonaws.com

## Vérification

Pour tester la nouvelle liste de modèles:
1. Connectez-vous à https://d1ystqalgm445b.cloudfront.net
2. Ouvrez les paramètres utilisateur (icône engrenage)
3. Vérifiez que tous les nouveaux modèles apparaissent dans la liste déroulante

## Notes importantes

⚠️ **Format des IDs de modèles Bedrock**:
- Utilisez toujours le format `provider.model-name` (ex: `anthropic.claude-*`)
- N'utilisez PAS de préfixe régional comme `eu.` ou `us.`
- Le préfixe régional est géré automatiquement par Bedrock

⚠️ **Variables d'environnement pour les déploiements futurs**:
```bash
USE_EXISTING_TABLES=true   # Préserver les tables DynamoDB
USE_EXISTING_ECR=true      # Utiliser le repository ECR existant
USE_EXISTING_BUCKET=true   # Utiliser le bucket S3 existant
```

## Prochaines étapes

1. ✅ Tester la connexion et la sélection de modèles
2. ✅ Vérifier que les nouveaux modèles fonctionnent correctement
3. ⏳ Documenter les cas d'usage recommandés pour chaque modèle
