{{- define "perfpulse.nameForSurface" -}}
{{- if eq . "k8s-direct" -}}direct{{- else if eq . "k8s-kueue" -}}kueue{{- else if eq . "skaha" -}}skaha{{- else -}}{{ fail (printf "unsupported surface %s" .) }}{{- end -}}
{{- end -}}

{{- define "perfpulse.labels" -}}
app.kubernetes.io/name: perfpulse
app.kubernetes.io/part-of: perfpulse
{{- end -}}

{{- define "perfpulse.workloadWriterName" -}}
{{- printf "%s-workload-writer" .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "perfpulse.campaignSurfaceName" -}}
{{- printf "%s-%s" .releaseName .surfaceShort | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "perfpulse.campaignConfigMapName" -}}
{{- printf "%s-%s-config" .releaseName .surfaceShort | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "perfpulse.serviceAccountName" -}}
{{- .Values.serviceAccount.name -}}
{{- end -}}

{{- define "perfpulse.image" -}}
{{- printf "%s:%s" .Values.image.repository .Values.image.tag -}}
{{- end -}}

{{- define "perfpulse.podSecurityContext" -}}
runAsGroup: 1000
runAsNonRoot: true
runAsUser: 1000
seccompProfile:
  type: RuntimeDefault
{{- end -}}

{{- define "perfpulse.containerSecurityContext" -}}
allowPrivilegeEscalation: false
capabilities:
  drop:
    - ALL
runAsGroup: 1000
runAsNonRoot: true
runAsUser: 1000
seccompProfile:
  type: RuntimeDefault
{{- end -}}

{{- define "perfpulse.validateCampaign" -}}
{{- $_ := required "campaign.totalJobs is required" .Values.campaign.totalJobs -}}
{{- $_ := required "campaign.logicalUsers is required" .Values.campaign.logicalUsers -}}
{{- $_ := required "campaign.testid is required" .Values.campaign.testid -}}
{{- if hasKey .Values.campaign "completionGateSeconds" -}}{{ fail "campaign.completionGateSeconds has been replaced by campaign.completionTimeoutSeconds" }}{{- end -}}
{{- if and (eq .Values.campaign.type "stress") (not .Values.campaign.confirmStress) -}}{{ fail "stress campaigns require campaign.confirmStress=true" }}{{- end -}}
{{- if and (ne .Values.campaign.type "benchmark") (ne .Values.campaign.type "stress") -}}{{ fail "campaign.type must be benchmark or stress" }}{{- end -}}
{{- if lt (int .Values.campaign.totalJobs) 1 -}}{{ fail "campaign.totalJobs must be greater than 0" }}{{- end -}}
{{- if lt (int .Values.campaign.logicalUsers) 1 -}}{{ fail "campaign.logicalUsers must be greater than 0" }}{{- end -}}
{{- if and (gt (int .Values.campaign.logicalUsers) 25) (not .Values.campaign.confirmHighUsers) -}}{{ fail "campaign.logicalUsers above 25 require campaign.confirmHighUsers=true" }}{{- end -}}
{{- if and (gt (int .Values.campaign.totalJobs) 10000) (ne .Values.campaign.type "stress") -}}{{ fail "campaign.totalJobs above 10000 requires campaign.type=stress" }}{{- end -}}
{{- if lt (int .Values.campaign.visibilityGateSeconds) 1 -}}{{ fail "campaign.visibilityGateSeconds must be greater than 0" }}{{- end -}}
{{- if lt (int .Values.campaign.completionTimeoutSeconds) (int .Values.campaign.visibilityGateSeconds) -}}{{ fail "campaign.completionTimeoutSeconds must be greater than or equal to campaign.visibilityGateSeconds" }}{{- end -}}
{{- if lt (int .Values.campaign.submissionJitterMaxMs) 0 -}}{{ fail "campaign.submissionJitterMaxMs must be greater than or equal to 0" }}{{- end -}}
{{- if lt (int .Values.campaign.pollJitterMaxMs) 0 -}}{{ fail "campaign.pollJitterMaxMs must be greater than or equal to 0" }}{{- end -}}
{{- end -}}
