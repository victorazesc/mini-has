"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { useHeaderTitle } from "@/src/providers/header-title-provider"
import { useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, DatabaseBackup, Download, FileJson, Loader2, RotateCcw, Upload } from "lucide-react"
import { ChangeEvent, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

export default function SettingsPage() {
  const { setTitle, setRightAction } = useHeaderTitle()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)

  useEffect(() => {
    setTitle("Configurações")
    setRightAction(null)

    return () => {
      setTitle(null)
      setRightAction(null)
    }
  }, [setRightAction, setTitle])

  const exportBackup = async () => {
    setIsExporting(true)
    try {
      const response = await fetch("/api/backup", { method: "GET" })
      if (!response.ok) throw new Error(await errorMessage(response, "Falha ao gerar backup."))

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = filenameFrom(response.headers.get("content-disposition"))
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      toast.success("Backup exportado")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao gerar backup.")
    } finally {
      setIsExporting(false)
    }
  }

  const restoreBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const confirmed = window.confirm("Recuperar este backup vai substituir os dados atuais do Mini HAS. Continuar?")
    if (!confirmed) {
      event.target.value = ""
      return
    }

    setIsRestoring(true)
    try {
      const text = await file.text()
      JSON.parse(text)

      const response = await fetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: text,
      })
      if (!response.ok) throw new Error(await errorMessage(response, "Falha ao recuperar backup."))

      await queryClient.invalidateQueries()
      toast.success("Backup recuperado com sucesso")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Arquivo de backup invalido.")
    } finally {
      setIsRestoring(false)
      event.target.value = ""
    }
  }

  return (
    <main className="flex flex-1 flex-col px-3 sm:px-4 lg:px-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
        <section className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <DatabaseBackup className="size-4" />
            Sistema
          </div>
          <h1 className="text-2xl font-semibold tracking-normal">Backup e recuperação</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Exporte a configuração da casa inteligente em um arquivo JSON e restaure esse arquivo quando precisar migrar ou recuperar a instalação.
          </p>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Download className="size-5" /> Realizar backup
              </CardTitle>
              <CardDescription>
                Inclui dispositivos, integrações, ambientes, cenas, automações, posições, histórico local e credenciais salvas.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-start gap-3 rounded-lg border bg-secondary/20 p-3 text-sm text-muted-foreground">
                <FileJson className="mt-0.5 size-4 shrink-0" />
                O arquivo gerado pode conter senhas, tokens e dados de acesso das integrações.
              </div>
            </CardContent>
            <CardFooter>
              <Button className="w-full sm:w-auto" disabled={isExporting || isRestoring} onClick={exportBackup}>
                {isExporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                {isExporting ? "Gerando..." : "Realizar backup"}
              </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <RotateCcw className="size-5" /> Recuperar backup
              </CardTitle>
              <CardDescription>
                Restaura um arquivo exportado pelo Mini HAS e substitui os dados atuais da instalação.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                A recuperação sobrescreve a base atual. Faça um backup novo antes de continuar.
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={restoreBackup}
              />
            </CardContent>
            <CardFooter>
              <Button
                className="w-full sm:w-auto"
                disabled={isExporting || isRestoring}
                onClick={() => fileInputRef.current?.click()}
                variant="outline"
              >
                {isRestoring ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                {isRestoring ? "Recuperando..." : "Recuperar backup"}
              </Button>
            </CardFooter>
          </Card>
        </section>

        <Separator />

        <section className="rounded-lg border bg-secondary/20 p-4 text-sm text-muted-foreground">
          O backup preserva os identificadores internos para cenas, automações, entidades e dispositivos continuarem ligados entre si depois da restauração.
        </section>
      </div>
    </main>
  )
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json()
    return data?.message || fallback
  } catch {
    return fallback
  }
}

function filenameFrom(contentDisposition: string | null): string {
  const match = contentDisposition?.match(/filename="?([^";]+)"?/i)
  return match?.[1] || `mini-has-backup-${new Date().toISOString().slice(0, 10)}.json`
}
