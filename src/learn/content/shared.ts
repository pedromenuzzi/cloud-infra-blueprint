/**
 * Building blocks lesson content shares. Lessons keep their code small and
 * in `main.tf` until the lesson that introduces more files.
 */
import type { Files } from '../types';

/** the `terraform` + `provider "aws"` header every AWS lesson starts from */
export const AWS_HEADER = `terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}
`;

export const AZURE_HEADER = `terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}

provider "azurerm" {
  features {}
}
`;

/** `main.tf` with the AWS header and then `body` (plus any other files) */
export const aws = (body = '', more: Files = {}): Files => ({
  'main.tf': body ? `${AWS_HEADER}\n${body}` : AWS_HEADER,
  ...more,
});

export const azure = (body = '', more: Files = {}): Files => ({
  'main.tf': body ? `${AZURE_HEADER}\n${body}` : AZURE_HEADER,
  ...more,
});
