-- Add timestamp columns to track when terraform and architecture were last generated/modified
-- This enables detection of "outdated" terraform/PDF when architecture changes

ALTER TABLE projects ADD COLUMN IF NOT EXISTS terraform_generated_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS architecture_modified_at TIMESTAMP WITH TIME ZONE;