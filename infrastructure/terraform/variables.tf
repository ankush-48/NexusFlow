variable "region" {
  type        = string
  description = "AWS region for the stack and ACM certificate."
  default     = "ap-south-1"
}
variable "certificate_arn" {
  type        = string
  description = "ARN of an issued ACM certificate matching the NexusFlow hostname."
}
variable "bucket_name" {
  type        = string
  description = "Globally unique name for the private object bucket."
}
variable "instance_type" {
  type        = string
  description = "Instance size for the single-node Compose deployment."
  default     = "t3.large"
}
variable "rds_instance_class" {
  type    = string
  default = "db.t4g.micro"
}
variable "smtp_ipv4_cidrs" {
  type        = set(string)
  description = "IPv4 CIDRs published by the selected SMTP provider. An empty set disables SMTP egress."
  default     = []
  validation {
    condition     = alltrue([for cidr in var.smtp_ipv4_cidrs : can(cidrnetmask(cidr)) && try(tonumber(split("/", cidr)[1]) > 0, false)])
    error_message = "Use specific IPv4 SMTP ranges."
  }
}
variable "internal_alb" {
  type        = bool
  description = "Use a private load balancer that requires connectivity into the VPC."
  default     = false
}
variable "ingress_ipv4_cidr" {
  type        = string
  description = "IPv4 range allowed to reach HTTPS. Use the organization's egress range for internet-facing staging."
  default     = "0.0.0.0/0"
  validation {
    condition     = can(cidrnetmask(var.ingress_ipv4_cidr))
    error_message = "Specify a valid IPv4 CIDR."
  }
}
variable "https_egress_ipv4_cidrs" {
  type        = set(string)
  description = "IPv4 destinations for direct outbound HTTPS from the app host, including registries, AWS endpoints and package mirrors."
  default     = ["0.0.0.0/0"]
  validation {
    condition     = alltrue([for cidr in var.https_egress_ipv4_cidrs : can(cidrnetmask(cidr))])
    error_message = "Use valid IPv4 CIDRs for HTTPS."
  }
}
variable "smtp_port" {
  type        = number
  description = "TCP port of the chosen SMTP relay with STARTTLS."
  default     = 587
  validation {
    condition     = var.smtp_port >= 1 && var.smtp_port <= 65535 && floor(var.smtp_port) == var.smtp_port
    error_message = "Use an integer TCP port from 1 to 65535."
  }
}
