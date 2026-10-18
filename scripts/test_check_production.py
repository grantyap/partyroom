import copy
import unittest

from check_production import JOBS, SERVICES, check_containers


def container(service, project="current", status="running", health="healthy", exit_code=0):
    return {
        "Name": f"/{service}-testresource-{project}",
        "Config": {"Labels": {"com.docker.compose.service": service, "com.docker.compose.project": project}},
        "State": {"Status": status, "Health": {"Status": health}, "ExitCode": exit_code},
    }


class ProductionSmokeTest(unittest.TestCase):
    def setUp(self):
        self.containers = [container(s) for s in SERVICES] + [container(s, status="exited") for s in JOBS]

    def test_healthy_stack_with_stopped_old_containers(self):
        old = [container(s, project="old", status="exited") for s in SERVICES + JOBS]
        check_containers(self.containers + old, "testresource")

    def test_duplicate_backend_from_another_project_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "Expected one running backend; found 2"):
            check_containers(self.containers + [container("backend", project="orphan")], "testresource")

    def test_missing_service_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "Expected one running web; found 0"):
            check_containers(self.containers[1:], "testresource")

    def test_unhealthy_or_restarting_service_is_rejected(self):
        for state in ({"Status": "running", "Health": {"Status": "unhealthy"}}, {"Status": "restarting"}):
            broken = copy.deepcopy(self.containers)
            broken[0]["State"] = state
            with self.assertRaises(ValueError):
                check_containers(broken, "testresource")

    def test_services_from_different_projects_are_rejected(self):
        self.containers[0]["Config"]["Labels"]["com.docker.compose.project"] = "orphan"
        with self.assertRaisesRegex(ValueError, "multiple Compose projects"):
            check_containers(self.containers, "testresource")

    def test_failed_unfinished_or_missing_deployment_job_is_rejected(self):
        for status, exit_code in (("exited", 1), ("running", 0)):
            broken = copy.deepcopy(self.containers)
            broken[-1]["State"].update(Status=status, ExitCode=exit_code)
            with self.assertRaisesRegex(ValueError, "queue-release must have completed"):
                check_containers(broken, "testresource")
        with self.assertRaisesRegex(ValueError, "queue-release must have completed"):
            check_containers(self.containers[:-1], "testresource")

    def test_other_applications_are_ignored(self):
        other = container("backend", project="other")
        other["Name"] = "/backend-otherresource-other"
        check_containers(self.containers + [other], "testresource")


if __name__ == "__main__":
    unittest.main()
