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

{{- define "perfpulse.serviceAccountName" -}}
{{- .Values.serviceAccount.name -}}
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
{{- if and (eq .Values.campaign.type "stress") (not .Values.campaign.confirmStress) -}}{{ fail "stress campaigns require campaign.confirmStress=true" }}{{- end -}}
{{- if and (ne .Values.campaign.type "benchmark") (ne .Values.campaign.type "stress") -}}{{ fail "campaign.type must be benchmark or stress" }}{{- end -}}
{{- if lt (int .Values.campaign.totalJobs) 1 -}}{{ fail "campaign.totalJobs must be greater than 0" }}{{- end -}}
{{- if lt (int .Values.campaign.logicalUsers) 1 -}}{{ fail "campaign.logicalUsers must be greater than 0" }}{{- end -}}
{{- if ne (mod (int .Values.campaign.totalJobs) (int .Values.campaign.logicalUsers)) 0 -}}{{ fail "campaign.totalJobs must divide evenly across campaign.logicalUsers" }}{{- end -}}
{{- if and (gt (int .Values.campaign.logicalUsers) 25) (not .Values.campaign.confirmHighUsers) -}}{{ fail "campaign.logicalUsers above 25 require campaign.confirmHighUsers=true" }}{{- end -}}
{{- if and (gt (int .Values.campaign.totalJobs) 10000) (ne .Values.campaign.type "stress") -}}{{ fail "campaign.totalJobs above 10000 requires campaign.type=stress" }}{{- end -}}
{{- if lt (int .Values.campaign.visibilityGateSeconds) 1 -}}{{ fail "campaign.visibilityGateSeconds must be greater than 0" }}{{- end -}}
{{- if lt (int .Values.campaign.completionGateSeconds) (int .Values.campaign.visibilityGateSeconds) -}}{{ fail "campaign.completionGateSeconds must be greater than or equal to campaign.visibilityGateSeconds" }}{{- end -}}
{{- end -}}
