{{- define "perfpulse.nameForSurface" -}}
{{- if eq . "k8s-direct" -}}direct{{- else if eq . "k8s-kueue" -}}kueue{{- else if eq . "skaha" -}}skaha{{- else -}}{{ fail (printf "unsupported surface %s" .) }}{{- end -}}
{{- end -}}

{{- define "perfpulse.labels" -}}
app.kubernetes.io/name: perfpulse
app.kubernetes.io/part-of: perfpulse
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
