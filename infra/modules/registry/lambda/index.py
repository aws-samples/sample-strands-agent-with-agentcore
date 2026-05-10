"""Custom Resource Lambda for AgentCore Registry management.

Handles Registry and RegistryRecord lifecycle (Create/Update/Delete) via
the bedrock-agentcore-control boto3 API, since CloudFormation/Terraform does
not yet have native resource types for Registry.

Invoked by Terraform's aws_cloudformation_stack resource as a custom resource.
"""

import json
import logging
import os
import time
import urllib.request

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

client = boto3.client(
    "bedrock-agentcore-control",
    region_name=os.environ.get("AWS_REGION", "us-west-2"),
)


def send_response(event, status, data=None, reason=""):
    """Send response to CloudFormation."""
    body = json.dumps({
        "Status": status,
        "Reason": reason or "See CloudWatch logs",
        "PhysicalResourceId": (
            data.get("PhysicalResourceId", event.get("PhysicalResourceId", event["RequestId"]))
            if data else event.get("PhysicalResourceId", event["RequestId"])
        ),
        "StackId": event["StackId"],
        "RequestId": event["RequestId"],
        "LogicalResourceId": event["LogicalResourceId"],
        "Data": data or {},
    }).encode()

    req = urllib.request.Request(
        event["ResponseURL"],
        data=body,
        method="PUT",
        headers={"Content-Type": ""},
    )
    urllib.request.urlopen(req)


def wait_for_registry_ready(registry_id, max_wait=120):
    """Poll until registry status is READY."""
    start = time.time()
    while time.time() - start < max_wait:
        resp = client.get_registry(registryId=registry_id)
        status = resp.get("status", "")
        if status == "READY":
            return True
        if "FAILED" in status:
            reason = resp.get("statusReason", "")
            raise Exception(f"Registry entered {status} state: {reason}")
        logger.info(f"Registry {registry_id} status: {status}, waiting...")
        time.sleep(5)
    raise Exception(f"Registry {registry_id} did not become READY within {max_wait}s")


def handle_registry(event, props):
    """Manage Registry lifecycle."""
    request_type = event["RequestType"]
    name = props["RegistryName"]
    description = props.get("RegistryDescription", "")
    auto_approval = props.get("AutoApproval", "false").lower() == "true"

    if request_type == "Create":
        resp = client.create_registry(
            name=name,
            description=description,
            approvalConfiguration={"autoApproval": auto_approval},
        )
        registry_arn = resp["registryArn"]
        registry_id = registry_arn.split("/")[-1]
        logger.info(f"Created registry: {registry_id} (arn={registry_arn})")

        wait_for_registry_ready(registry_id)

        return {
            "PhysicalResourceId": registry_id,
            "RegistryId": registry_id,
            "RegistryArn": registry_arn,
        }

    elif request_type == "Update":
        registry_id = event["PhysicalResourceId"]
        client.update_registry(
            registryId=registry_id,
            description=description,
            approvalConfiguration={"autoApproval": auto_approval},
        )
        wait_for_registry_ready(registry_id)
        resp = client.get_registry(registryId=registry_id)
        return {
            "PhysicalResourceId": registry_id,
            "RegistryId": registry_id,
            "RegistryArn": resp.get("registryArn", ""),
        }

    elif request_type == "Delete":
        registry_id = event["PhysicalResourceId"]
        try:
            # ListRegistryRecords returns [] unless a status filter is supplied,
            # so iterate over every status to catch all records.
            statuses = [
                "DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED",
                "DEPRECATED", "CREATING", "UPDATING", "CREATE_FAILED", "UPDATE_FAILED",
            ]
            seen = set()
            for status in statuses:
                token = None
                while True:
                    kwargs = {"registryId": registry_id, "status": status, "maxResults": 100}
                    if token:
                        kwargs["nextToken"] = token
                    resp = client.list_registry_records(**kwargs)
                    for r in resp.get("registryRecords", []):
                        rec_id = r.get("recordId") or r.get("recordArn", "").split("/")[-1]
                        if not rec_id or rec_id in seen:
                            continue
                        seen.add(rec_id)
                        try:
                            client.delete_registry_record(registryId=registry_id, recordId=rec_id)
                            logger.info(f"Deleted record: {rec_id}")
                        except Exception as e:
                            logger.warning(f"Failed to delete record {rec_id}: {e}")
                    token = resp.get("nextToken")
                    if not token:
                        break

            client.delete_registry(registryId=registry_id)
            logger.info(f"Deleted registry: {registry_id}")
        except client.exceptions.ResourceNotFoundException:
            logger.info(f"Registry {registry_id} already deleted")
        except Exception as e:
            logger.warning(f"Error deleting registry {registry_id}: {e}")
        return {"PhysicalResourceId": registry_id}


def _wait_for_record(registry_id, record_id, transient_status, max_wait=60):
    """Poll until record leaves a transient status (CREATING/UPDATING)."""
    start = time.time()
    while time.time() - start < max_wait:
        try:
            rec = client.get_registry_record(registryId=registry_id, recordId=record_id)
            if rec.get("status", "") != transient_status:
                return rec.get("status", "")
        except Exception:
            pass
        time.sleep(5)
    return transient_status


def handle_record(event, props):
    """Manage AGENT_SKILLS RegistryRecord lifecycle."""
    request_type = event["RequestType"]
    registry_id = props["RegistryId"]
    name = props["RecordName"]
    description = props.get("RecordDescription", "")
    record_version = props.get("RecordVersion", "1.0.0")

    skill_md_content = props.get("SkillMdContent", "")
    skill_def_json = props.get("SkillDefinitionJson", "")

    descriptors = {
        "agentSkills": {
            "skillMd": {"inlineContent": skill_md_content},
        }
    }
    if skill_def_json:
        descriptors["agentSkills"]["skillDefinition"] = {
            "schemaVersion": "0.1.0",
            "inlineContent": skill_def_json,
        }

    if request_type == "Create":
        resp = client.create_registry_record(
            registryId=registry_id,
            name=name,
            description=description,
            recordVersion=record_version,
            descriptorType="AGENT_SKILLS",
            descriptors=descriptors,
        )
        record_arn = resp.get("recordArn", "")
        record_id = record_arn.split("/")[-1] if record_arn else resp.get("recordId", "")
        logger.info(f"Created record: {record_id} ({name})")

        _wait_for_record(registry_id, record_id, "CREATING")

        try:
            client.submit_registry_record_for_approval(
                registryId=registry_id, recordId=record_id,
            )
            logger.info(f"Submitted record {record_id} for approval")
        except Exception as e:
            logger.warning(f"Submit for approval failed: {e}")

        return {"PhysicalResourceId": record_id, "RecordId": record_id}

    elif request_type == "Update":
        record_id = event["PhysicalResourceId"]

        update_skills = {
            "skillMd": {"optionalValue": descriptors["agentSkills"]["skillMd"]},
        }
        if "skillDefinition" in descriptors["agentSkills"]:
            update_skills["skillDefinition"] = {
                "optionalValue": descriptors["agentSkills"]["skillDefinition"]
            }

        client.update_registry_record(
            registryId=registry_id,
            recordId=record_id,
            description={"optionalValue": description},
            recordVersion=record_version,
            descriptors={"optionalValue": {
                "agentSkills": {"optionalValue": update_skills},
            }},
        )
        logger.info(f"Updated record: {record_id}")

        _wait_for_record(registry_id, record_id, "UPDATING")

        try:
            client.submit_registry_record_for_approval(
                registryId=registry_id, recordId=record_id,
            )
            logger.info(f"Submitted record {record_id} for approval")
        except Exception as e:
            logger.warning(f"Submit for approval failed: {e}")

        return {"PhysicalResourceId": record_id, "RecordId": record_id}

    elif request_type == "Delete":
        record_id = event["PhysicalResourceId"]
        try:
            client.delete_registry_record(registryId=registry_id, recordId=record_id)
            logger.info(f"Deleted record: {record_id}")
        except client.exceptions.ResourceNotFoundException:
            logger.info(f"Record {record_id} already deleted")
        except Exception as e:
            logger.warning(f"Error deleting record {record_id}: {e}")
        return {"PhysicalResourceId": record_id}


def handle_update_record_direct(event):
    """Direct-invoke path for Terraform null_resource triggers.

    Bypasses CloudFormation because CFN's get-template API strips non-ASCII
    characters to '?', causing permanent drift on SKILL.md content. Registry
    data itself is preserved correctly; only CFN's surface representation
    was corrupted. Direct invoke on content change keeps the record in sync
    without round-tripping through CFN.
    """
    registry_id = event["registry_id"]
    record_id = event["record_id"]
    description = event.get("description", "")
    record_version = event.get("record_version", "1.0.0")
    skill_md_content = event.get("skill_md_content", "")
    skill_def_json = event.get("skill_definition_json", "")

    update_skills = {"skillMd": {"optionalValue": {"inlineContent": skill_md_content}}}
    if skill_def_json:
        update_skills["skillDefinition"] = {"optionalValue": {
            "schemaVersion": "0.1.0", "inlineContent": skill_def_json,
        }}

    client.update_registry_record(
        registryId=registry_id,
        recordId=record_id,
        description={"optionalValue": description},
        recordVersion=record_version,
        descriptors={"optionalValue": {"agentSkills": {"optionalValue": update_skills}}},
    )
    logger.info(f"Direct-invoke updated record: {record_id}")

    _wait_for_record(registry_id, record_id, "UPDATING")

    try:
        client.submit_registry_record_for_approval(registryId=registry_id, recordId=record_id)
        logger.info(f"Submitted record {record_id} for approval")
    except Exception as e:
        logger.warning(f"Submit for approval failed: {e}")

    return {"record_id": record_id, "status": "updated"}


def lambda_handler(event, context):
    """CloudFormation Custom Resource handler + Terraform direct-invoke path."""
    # Direct-invoke path (Terraform null_resource triggers).
    if event.get("direct_invoke"):
        action = event.get("action", "")
        logger.info(f"Direct invoke: action={action}")
        if action == "UPDATE_RECORD":
            return handle_update_record_direct(event)
        raise ValueError(f"Unknown direct-invoke action: {action}")

    # CloudFormation Custom Resource path.
    logger.info(f"Event: RequestType={event['RequestType']}, Action={event.get('ResourceProperties', {}).get('Action', 'unknown')}")

    try:
        props = event.get("ResourceProperties", {})
        action = props.get("Action", "")

        if action == "MANAGE_REGISTRY":
            data = handle_registry(event, props)
        elif action == "MANAGE_RECORD":
            data = handle_record(event, props)
        else:
            raise ValueError(f"Unknown action: {action}")

        send_response(event, "SUCCESS", data)

    except Exception as e:
        logger.error(f"Error: {e}", exc_info=True)
        send_response(event, "FAILED", reason=str(e))
