const ENGLISH_MARKERS = new Set([
    "the", "and", "with", "without", "from", "toward", "away", "front", "gate",
    "street", "property", "person", "people", "cyclist", "cyclists", "vehicle",
    "vehicles", "passed", "passing", "walked", "walking", "moving", "stopped",
    "stopping", "interacting", "appears", "visible", "right", "left", "one",
    "two", "three", "uncertain", "because", "during", "event",
])

const SUBJECT_LABELS: Record<string, { singular: string; plural: string; feminine?: boolean }> = {
    person: { singular: "pessoa", plural: "pessoas", feminine: true },
    cyclist: { singular: "ciclista", plural: "ciclistas" },
    motorcyclist: { singular: "motociclista", plural: "motociclistas" },
    car: { singular: "carro", plural: "carros" },
    truck: { singular: "caminhão", plural: "caminhões" },
    bus: { singular: "ônibus", plural: "ônibus" },
    motorcycle: { singular: "moto", plural: "motos", feminine: true },
    bicycle: { singular: "bicicleta", plural: "bicicletas", feminine: true },
    dog: { singular: "cachorro", plural: "cachorros" },
    cat: { singular: "gato", plural: "gatos" },
    animal: { singular: "animal", plural: "animais" },
    package: { singular: "pacote", plural: "pacotes" },
    object: { singular: "objeto", plural: "objetos" },
}

const DIRECTION_LABELS: Record<string, string> = {
    left_to_right: "da esquerda para a direita",
    right_to_left: "da direita para a esquerda",
    toward_house: "em direção à casa",
    away_from_house: "afastando-se da casa",
}

export function isLikelyEnglishCameraText(value: string): boolean {
    const words = value.toLocaleLowerCase("pt-BR").match(/[\p{L}]+/gu) || []
    return words.filter((word) => ENGLISH_MARKERS.has(word)).length >= 2
}

export function cameraObservationDescriptionPtBr(
    semantic: Record<string, unknown> | null | undefined,
): string {
    const observations = objectArray(semantic?.observations)
    const counts = new Map<string, number>()
    for (const observation of observations) {
        const subject = stringValue(observation.subject)
        const count = typeof observation.count === "number" && Number.isInteger(observation.count)
            ? Math.min(20, Math.max(1, observation.count))
            : 1
        if (SUBJECT_LABELS[subject]) counts.set(subject, Math.max(counts.get(subject) || 0, count))
    }
    const actors = [...counts].map(([subject, count]) => formatSubject(subject, count))
    if (!actors.length) return ""

    const total = [...counts.values()].reduce((sum, count) => sum + count, 0)
    const directions = new Set(observations.map((item) => stringValue(item.direction)).filter(Boolean))
    const direction = directions.size === 1 ? DIRECTION_LABELS[[...directions][0]] || "" : ""
    const actions = observations.flatMap((item) => stringArray(item.actions))
    const passed = actions.length > 0 && actions.every((action) => ["passed", "walked", "ran"].includes(action))
    const verb = passed
        ? total === 1 ? "passou" : "passaram"
        : total === 1 ? "foi visto" : "foram vistos"
    const description = `${formatNaturalList(actors)} ${verb}${direction ? ` ${direction}` : ""} diante da câmera.`
    return description.charAt(0).toLocaleUpperCase("pt-BR") + description.slice(1)
}

function formatSubject(subject: string, count: number): string {
    const label = SUBJECT_LABELS[subject]
    if (count === 1) return `${label.feminine ? "uma" : "um"} ${label.singular}`
    const quantity = count === 2 ? label.feminine ? "duas" : "dois" : String(count)
    return `${quantity} ${label.plural}`
}

function formatNaturalList(values: string[]): string {
    if (values.length <= 1) return values[0] || ""
    return `${values.slice(0, -1).join(", ")} e ${values.at(-1)}`
}

function objectArray(value: unknown): Record<string, unknown>[] {
    return Array.isArray(value)
        ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
        : []
}

function stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : []
}

function stringValue(value: unknown): string {
    return typeof value === "string" ? value.trim() : ""
}
