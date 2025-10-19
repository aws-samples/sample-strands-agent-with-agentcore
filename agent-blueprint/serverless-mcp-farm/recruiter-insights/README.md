# Recruiter Insights Lambda MCP Server

A serverless MCP (Model Context Protocol) server for resume analysis and candidate matching, deployed on AWS Lambda with API Gateway.

## 🚀 Current Deployment

**Status**: ✅ **DEPLOYED & OPERATIONAL**

**Stack**: `mcp-recruiter-insights-server` (CloudFormation)
**Region**: `us-west-2`

## 🛠️ Architecture

- **Runtime**: AWS Lambda (Python 3.11)
- **Framework**: `awslabs-mcp-lambda-handler` (Lambda-optimized)
- **API**: API Gateway REST API
- **Storage**: S3 bucket for resume files
- **Infrastructure**: CloudFormation template

## 📋 Available Tools

1. **listS3Bucket** - Lists resume files in S3 bucket
2. **extractResumeData** - Extracts structured candidate data from resumes with skill analysis
3. **matchCandidatesToJob** - Match candidates to job descriptions using text similarity
4. **generateRecruiterInsights** - Generate comprehensive recruiter analytics and insights
5. **generateExecutiveSummary** - Generate executive summaries for leadership team

## 🚀 Quick Deployment

```bash
# Deploy everything with one command (fully automated)
cd infrastructure
./deploy.sh
```

This single script will:
- Deploy complete CloudFormation stack with inline Lambda code
- Create S3 bucket, Lambda function, and API Gateway
- Populate S3 bucket with sample resumes
- **No manual CLI commands or code uploads required**

## 📁 Project Structure

```
recruiter-insights/
├── README.md              # Main documentation
├── Dockerfile             # Container definition
├── src/                   # Source code
│   ├── lambda_function.py # Lambda entry point
│   ├── mcp_server.py     # MCP server implementation
│   └── requirements.txt  # Python dependencies
├── infrastructure/        # CloudFormation & deployment
│   ├── cloudformation.yaml
│   └── deploy.sh
└── candidate-data/        # Sample resume data (24 resumes)
```

## ⚙️ Environment Variables

- `S3_BUCKET_NAME`: `mcp-recruiter-insights-server-resumes-824353418771`
- `RESUME_FOLDER`: `resumes/`
- `LOG_LEVEL`: `INFO`

## 🔐 IAM Permissions

The Lambda function requires:
- `s3:GetObject` and `s3:ListBucket` on the resume bucket
- CloudWatch Logs permissions for logging

## 📊 Current Data

- **Resumes Processed**: 24 candidates
- **Data Extracted**: Names, emails, phone numbers, skills
- **S3 Bucket**: Contains sample resume files
- **Skills Detected**: 25+ technical skills including Python, AWS, Docker, Kubernetes, SQL, machine learning

## 🔄 Redeployment

To redeploy with changes:

```bash
# Delete existing stack
aws cloudformation delete-stack --stack-name mcp-recruiter-insights-server --region us-west-2

# Wait for deletion
aws cloudformation wait stack-delete-complete --stack-name mcp-recruiter-insights-server --region us-west-2

# Redeploy
./deploy.sh
```

## 🏗️ Technical Details

- **Package Size**: ~16MB (optimized without scipy dependencies)
- **Memory**: 1024MB
- **Timeout**: 300 seconds
- **Runtime**: Python 3.11
- **Handler**: `lambda_function.lambda_handler`

## 📝 Features

- **Skill Extraction**: Automatically detects 25+ technical skills from resumes
- **True Semantic Search**: Uses sentence-transformers (all-MiniLM-L6-v2) for deep semantic understanding
- **Cosine Similarity**: Real vector-based similarity scoring with embeddings
- **Analytics**: Comprehensive recruiter insights with skill distribution analysis
- **Recommendations**: Color-coded system (🟢 Highly Recommend ≥70%, 🟡 Recommend ≥50%, 🟠 Consider ≥30%, 🔴 Not Recommend <30%)
- **Executive Summaries**: Leadership-focused candidate pipeline reports

## 📝 Notes

- Uses `awslabs-mcp-lambda-handler` instead of FastMCP for Lambda optimization
- Follows the proven financial-market MCP server deployment pattern
- API Gateway provides HTTP endpoint for MCP protocol communication
- Enhanced semantic matching provides meaningful similarity scores (70%+ for highly recommended candidates)
- Multi-weighted algorithm considers technical skills, experience level, and keyword overlap
