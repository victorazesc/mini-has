import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "./ui/button"
import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/input-group"
import { ChevronRight, Globe, Search } from "lucide-react"
import { useState } from "react"
import Image from "next/image"
import { TuyaIntegrationDialog } from "./integration-providers/tuya-integration-dialog"
import { IntegrationProviderHandler } from "./integration-providers/integration-provider-handler"

const integrationProviders = [
    {
        value: "tuya_cloud",
        name: "Tuya Cloud",
        icon: "./providers/tuya.svg",
        localOnly: false,
    },
    {
        value: "smartthings_cloud",
        name: "SmartThings Cloud",
        icon: "./providers/smartthings.svg",
        localOnly: false,
    },
    {
        value: "intelbras_izy_tuya",
        name: "Intelbras Izy",
        icon: "./providers/intelbras.svg",
        localOnly: true,
    },
    {
        value: "diy",
        name: "DIY",
        icon: "./providers/diy.svg",
        localOnly: true,
    },
]

export function NewIntegrationDialog({ children }: { children: React.ReactElement }) {
    const [search, setSearch] = useState("")
    const [selectedProvider, setSelectedProvider] = useState<string | null>(null)

    const filteredProviders = integrationProviders.filter((provider) => provider.value.toLowerCase().includes(search.toLowerCase()))
    const handleProviderClick = (provider: string) => {
        setSelectedProvider(provider)
    }

    return (
        <>
            <IntegrationProviderHandler provider={selectedProvider ?? "" as string} />
            <Dialog>
                <DialogTrigger render={children} nativeButton={true} />
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Nova Integração</DialogTitle>
                        <DialogDescription>
                            Adicione uma nova integração para controlar seus dispositivos.
                        </DialogDescription>
                        <div className="flex flex-row gap-2 mt-4">
                            <InputGroup>
                                <InputGroupInput
                                    placeholder="Buscar integrações..."
                                    value={search}
                                    onChange={(event) => setSearch(event.target.value)}
                                />
                                <InputGroupAddon>
                                    <Search className="size-4" />
                                </InputGroupAddon>
                            </InputGroup>
                        </div>
                    </DialogHeader>
                    <div className="-mx-4 no-scrollbar max-h-[50vh] overflow-y-auto px-4">
                        {filteredProviders.map((provider) => (
                            <div key={provider.value} className="flex flex-row gap-2 items-center justify-between p-2 hover:bg-input/50 rounded-xl cursor-pointer" onClick={() => handleProviderClick(provider.value)}>
                                <div className="flex flex-row gap-2 items-center">
                                    <Image src={provider.icon} alt={provider.name} width={40} height={40} />
                                    <p className="text-sm font-medium">{provider.name}</p>
                                </div>
                                <div className="flex flex-row gap-2 items-center">
                                    {!provider.localOnly && <Globe className="size-4" />}
                                    <ChevronRight className="size-4" />
                                </div>
                            </div>

                        ))}
                    </div>
                    <DialogFooter>
                        <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>

    )
}       