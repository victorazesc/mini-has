import { Card, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { DynamicIcon, IconName } from "lucide-react/dynamic"
import { Room } from "@/src/services/rooms.service"
export function RoomCard({ room }: { room: Room }) {
    return (
        <Card className="cursor-pointer transition-all duration-300 hover:bg-secondary/80 hover:shadow-lg">
            <CardHeader>
                <CardTitle className="flex items-center justify-center gap-2 py-6">
                    {room.icon && <DynamicIcon name={room.icon as IconName} className="size-12" />}
                </CardTitle>
                <CardFooter className="flex items-center justify-center ">
                    <h1 className="text-lg font-semibold">{room.name}</h1>
                </CardFooter>
            </CardHeader>
        </Card>
    )
}