#!/usr/bin/env python3
"""
Recruiter Insights MCP Server with simple semantic search
"""

import json
import boto3
import os
import re
import math
from typing import List, Dict, Any, Set
from collections import Counter
from awslabs.mcp_lambda_handler import MCPLambdaHandler

# Create MCP Lambda handler
mcp = MCPLambdaHandler(name="recruiter-insights", version="2.0.0")

# Configuration
S3_BUCKET_NAME = os.environ.get('S3_BUCKET_NAME')
DEFAULT_RESUME_FOLDER = os.environ.get('RESUME_FOLDER', 'resumes/')

def calculate_semantic_similarity(resume_text: str, job_description: str) -> float:
    """Calculate semantic similarity using TF-IDF-like approach"""
    try:
        # Normalize and tokenize text
        def normalize_text(text: str) -> List[str]:
            text = re.sub(r'[^\w\s]', ' ', text.lower())
            words = text.split()
            stop_words = {'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those'}
            return [word for word in words if len(word) > 2 and word not in stop_words]
        
        resume_words = normalize_text(resume_text)
        job_words = normalize_text(job_description)
        
        if not resume_words or not job_words:
            return 0.0
        
        # Calculate word frequencies
        resume_freq = Counter(resume_words)
        job_freq = Counter(job_words)
        all_words = set(resume_words + job_words)
        
        # Calculate TF-IDF vectors
        def calculate_vector(word_freq: Counter, all_words: Set[str], total_words: int) -> Dict[str, float]:
            vector = {}
            for word in all_words:
                tf = word_freq.get(word, 0) / total_words if total_words > 0 else 0
                idf = math.log(len(all_words) / (1 + sum(1 for w in all_words if w in word_freq)))
                vector[word] = tf * idf
            return vector
        
        resume_vector = calculate_vector(resume_freq, all_words, len(resume_words))
        job_vector = calculate_vector(job_freq, all_words, len(job_words))
        
        # Calculate cosine similarity
        dot_product = sum(resume_vector[word] * job_vector[word] for word in all_words)
        resume_magnitude = math.sqrt(sum(val ** 2 for val in resume_vector.values()))
        job_magnitude = math.sqrt(sum(val ** 2 for val in job_vector.values()))
        
        if resume_magnitude == 0 or job_magnitude == 0:
            return 0.0
        
        similarity = dot_product / (resume_magnitude * job_magnitude)
        
        # Boost for skill matches
        skill_boost = calculate_skill_overlap(resume_text, job_description)
        final_similarity = (similarity * 0.7) + (skill_boost * 0.3)
        
        return min(max(final_similarity, 0.0), 1.0)
        
    except Exception as e:
        print(f"Error calculating semantic similarity: {e}")
        return calculate_keyword_similarity(resume_text, job_description)

def calculate_skill_overlap(resume_text: str, job_description: str) -> float:
    """Calculate skill overlap boost"""
    skills = [
        'python', 'java', 'javascript', 'typescript', 'react', 'angular', 'vue',
        'node', 'express', 'django', 'flask', 'spring', 'aws', 'azure', 'gcp',
        'docker', 'kubernetes', 'terraform', 'git', 'sql', 'postgresql', 'mysql',
        'mongodb', 'redis', 'machine learning', 'ai', 'data science', 'analytics'
    ]
    
    resume_lower = resume_text.lower()
    job_lower = job_description.lower()
    
    resume_skills = {skill for skill in skills if skill in resume_lower}
    job_skills = {skill for skill in skills if skill in job_lower}
    
    if not job_skills:
        return 0.0
    
    overlap = len(resume_skills.intersection(job_skills))
    return overlap / len(job_skills)

def calculate_keyword_similarity(resume_text: str, job_description: str) -> float:
    """Fallback keyword-based similarity"""
    resume_words = set(re.findall(r'\b\w+\b', resume_text.lower()))
    job_words = set(re.findall(r'\b\w+\b', job_description.lower()))
    
    if not job_words:
        return 0.0
    
    intersection = len(resume_words.intersection(job_words))
    return intersection / len(job_words)

def extract_skills_from_text(text: str) -> List[str]:
    """Extract skills from text"""
    skills = [
        'python', 'java', 'javascript', 'react', 'node.js', 'aws', 'docker', 'kubernetes',
        'sql', 'mongodb', 'postgresql', 'git', 'agile', 'scrum', 'machine learning',
        'data analysis', 'project management', 'leadership', 'communication', 'teamwork',
        'problem solving', 'html', 'css', 'angular', 'vue.js', 'typescript', 'c++', 'c#'
    ]
    
    text_lower = text.lower()
    found_skills = []
    
    for skill in skills:
        if skill.lower() in text_lower:
            found_skills.append(skill)
    
    return found_skills

@mcp.tool()
def listS3Bucket() -> str:
    """List all resume files in the S3 bucket"""
    try:
        s3 = boto3.client('s3')
        response = s3.list_objects_v2(Bucket=S3_BUCKET_NAME, Prefix=DEFAULT_RESUME_FOLDER)
        
        if 'Contents' not in response:
            return json.dumps({"message": "No files found in bucket"}, indent=2)
        
        files = []
        for obj in response['Contents']:
            if not obj['Key'].endswith('/'):
                files.append({
                    "filename": obj['Key'].replace(DEFAULT_RESUME_FOLDER, ''),
                    "size": obj['Size'],
                    "last_modified": obj['LastModified'].isoformat()
                })
        
        return json.dumps({"files": files, "total_count": len(files)}, indent=2)
    
    except Exception as e:
        return json.dumps({"error": str(e)}, indent=2)

@mcp.tool()
def extractResumeData(filename: str = "") -> str:
    """Extract structured data from resume files"""
    try:
        s3 = boto3.client('s3')
        
        if filename:
            key = f"{DEFAULT_RESUME_FOLDER}{filename}"
            try:
                response = s3.get_object(Bucket=S3_BUCKET_NAME, Key=key)
                content = response['Body'].read().decode('utf-8')
                
                # Extract basic info
                name_match = re.search(r'^([A-Z][a-z]+ [A-Z][a-z]+)', content, re.MULTILINE)
                email_match = re.search(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', content)
                phone_match = re.search(r'\b\d{3}[-.]?\d{3}[-.]?\d{4}\b', content)
                
                skills = extract_skills_from_text(content)
                
                return json.dumps({
                    "filename": filename,
                    "candidate_data": {
                        "name": name_match.group(1) if name_match else "Not found",
                        "email": email_match.group(0) if email_match else "Not found",
                        "phone": phone_match.group(0) if phone_match else "Not found",
                        "skills": skills,
                        "skill_count": len(skills)
                    }
                }, indent=2)
                
            except Exception as e:
                return json.dumps({"error": f"Could not process {filename}: {str(e)}"}, indent=2)
        
        # Process all files
        response = s3.list_objects_v2(Bucket=S3_BUCKET_NAME, Prefix=DEFAULT_RESUME_FOLDER)
        candidates = []
        
        for obj in response.get('Contents', []):
            if obj['Key'].endswith('/'):
                continue
                
            try:
                file_response = s3.get_object(Bucket=S3_BUCKET_NAME, Key=obj['Key'])
                content = file_response['Body'].read().decode('utf-8')
                
                name_match = re.search(r'^([A-Z][a-z]+ [A-Z][a-z]+)', content, re.MULTILINE)
                email_match = re.search(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', content)
                phone_match = re.search(r'\b\d{3}[-.]?\d{3}[-.]?\d{4}\b', content)
                
                skills = extract_skills_from_text(content)
                
                candidates.append({
                    "filename": obj['Key'].replace(DEFAULT_RESUME_FOLDER, ''),
                    "name": name_match.group(1) if name_match else "Not found",
                    "email": email_match.group(0) if email_match else "Not found", 
                    "phone": phone_match.group(0) if phone_match else "Not found",
                    "skills": skills,
                    "skill_count": len(skills)
                })
                
            except Exception as e:
                print(f"Error processing {obj['Key']}: {e}")
                continue
        
        return json.dumps({"candidates": candidates, "total_processed": len(candidates)}, indent=2)
        
    except Exception as e:
        return json.dumps({"error": str(e)}, indent=2)

@mcp.tool()
def matchCandidatesToJob(job_description: str, min_similarity: float = 0.3) -> str:
    """Match candidates to job description using semantic similarity"""
    try:
        s3 = boto3.client('s3')
        response = s3.list_objects_v2(Bucket=S3_BUCKET_NAME, Prefix=DEFAULT_RESUME_FOLDER)
        
        matches = []
        
        for obj in response.get('Contents', []):
            if obj['Key'].endswith('/'):
                continue
                
            try:
                file_response = s3.get_object(Bucket=S3_BUCKET_NAME, Key=obj['Key'])
                resume_content = file_response['Body'].read().decode('utf-8')
                
                # Calculate similarity
                match_score = calculate_semantic_similarity(resume_content, job_description)
                
                if match_score >= min_similarity:
                    name_match = re.search(r'^([A-Z][a-z]+ [A-Z][a-z]+)', resume_content, re.MULTILINE)
                    skills = extract_skills_from_text(resume_content)
                    
                    # Determine recommendation level
                    if match_score >= 0.7:
                        recommendation = "🟢 Highly Recommend"
                    elif match_score >= 0.5:
                        recommendation = "🟡 Recommend"
                    elif match_score >= 0.3:
                        recommendation = "🟠 Consider"
                    else:
                        recommendation = "🔴 Not Recommend"
                    
                    matches.append({
                        "filename": obj['Key'].replace(DEFAULT_RESUME_FOLDER, ''),
                        "candidate_name": name_match.group(1) if name_match else "Unknown",
                        "similarity_score": round(match_score * 100, 1),
                        "recommendation": recommendation,
                        "skills": skills[:5],  # Top 5 skills
                        "reasoning": f"Semantic similarity: {match_score:.1%}. Skills align with job requirements."
                    })
                    
            except Exception as e:
                print(f"Error processing {obj['Key']}: {e}")
                continue
        
        # Sort by similarity score
        matches.sort(key=lambda x: x['similarity_score'], reverse=True)
        
        return json.dumps({
            "job_description": job_description[:200] + "..." if len(job_description) > 200 else job_description,
            "total_matches": len(matches),
            "matches": matches,
            "summary": f"Found {len(matches)} candidates above {min_similarity:.0%} similarity threshold"
        }, indent=2)
        
    except Exception as e:
        return json.dumps({"error": str(e)}, indent=2)

@mcp.tool()
def generateRecruiterInsights(query: str = "general analysis") -> str:
    """Generate comprehensive recruiter analytics and insights"""
    try:
        s3 = boto3.client('s3')
        response = s3.list_objects_v2(Bucket=S3_BUCKET_NAME, Prefix=DEFAULT_RESUME_FOLDER)
        
        candidates = []
        all_skills = []
        
        for obj in response.get('Contents', []):
            if obj['Key'].endswith('/'):
                continue
                
            try:
                file_response = s3.get_object(Bucket=S3_BUCKET_NAME, Key=obj['Key'])
                content = file_response['Body'].read().decode('utf-8')
                
                name_match = re.search(r'^([A-Z][a-z]+ [A-Z][a-z]+)', content, re.MULTILINE)
                skills = extract_skills_from_text(content)
                
                candidates.append({
                    "name": name_match.group(1) if name_match else "Unknown",
                    "skills": skills
                })
                all_skills.extend(skills)
                
            except Exception as e:
                continue
        
        if not candidates:
            return json.dumps({"error": "No candidates found"}, indent=2)
        
        # Calculate skill distribution
        skill_counts = Counter(all_skills)
        top_skills = skill_counts.most_common(10)
        
        insights = {
            "query": query,
            "executive_summary": {
                "total_candidates": len(candidates),
                "avg_skills_per_candidate": round(len(all_skills) / len(candidates), 1),
                "most_common_skills": [f"{skill} ({count} candidates)" for skill, count in top_skills[:5]],
                "pipeline_strength": "Strong" if len(candidates) >= 10 else "Moderate" if len(candidates) >= 5 else "Limited"
            },
            "candidate_pool_analytics": {
                "skill_distribution": dict(top_skills),
                "candidates_by_skill_count": {
                    "high_skilled (8+ skills)": len([c for c in candidates if len(c['skills']) >= 8]),
                    "medium_skilled (4-7 skills)": len([c for c in candidates if 4 <= len(c['skills']) < 8]),
                    "entry_level (1-3 skills)": len([c for c in candidates if 1 <= len(c['skills']) < 4])
                }
            },
            "hiring_recommendations": {
                "immediate_interviews": [c['name'] for c in candidates if len(c['skills']) >= 8][:3],
                "pipeline_development": "Focus on technical skill assessment",
                "skill_gaps": [skill for skill, count in top_skills if count < len(candidates) * 0.3][:5]
            }
        }
        
        return json.dumps(insights, indent=2)
        
    except Exception as e:
        return json.dumps({"error": str(e)}, indent=2)

@mcp.tool()
def generateExecutiveSummary(focus_area: str = "general") -> str:
    """Generate executive summary for leadership team"""
    try:
        s3 = boto3.client('s3')
        response = s3.list_objects_v2(Bucket=S3_BUCKET_NAME, Prefix=DEFAULT_RESUME_FOLDER)
        resume_objects = response.get('Contents', [])
        
        total_candidates = len([obj for obj in resume_objects if not obj['Key'].endswith('/')])
        
        summary = {
            "executive_summary": {
                "report_date": "Current Analysis",
                "focus_area": focus_area,
                "key_metrics": {
                    "total_candidates_in_pipeline": total_candidates,
                    "pipeline_status": "Active",
                    "recommendation": "🟢 Pipeline Ready" if total_candidates >= 5 else "🟡 Pipeline Needs Development"
                },
                "strategic_insights": [
                    f"Current pipeline contains {total_candidates} candidates ready for evaluation",
                    "Semantic matching capabilities enable precise job-candidate alignment",
                    "Skill extraction provides detailed technical competency mapping"
                ],
                "next_steps": [
                    "Review high-similarity candidates for immediate interviews",
                    "Conduct technical assessments for medium-similarity matches",
                    "Expand sourcing for underrepresented skill areas"
                ]
            }
        }
        
        return json.dumps(summary, indent=2)
        
    except Exception as e:
        return json.dumps({"error": str(e)}, indent=2)
