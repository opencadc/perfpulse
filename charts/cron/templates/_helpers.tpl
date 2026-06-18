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

{{- define "perfpulse.testRunWriterName" -}}
{{- printf "%s-testrun-writer" .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "perfpulse.cronRunnerGateName" -}}
{{- printf "%s-runner-gate" .Release.Name | trunc 63 | trimSuffix "-" -}}
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
