import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { DynamicIcon, IconName } from "lucide-react/dynamic"
import { Room } from "@/src/services/rooms.service"
import { ComponentProps } from "react"

type RoomCardProps = {
    room: Room;
} & ComponentProps<typeof Card>;

export function RoomCard({ room, className, ...props }: RoomCardProps) {
    return (
        <Card className={cn("cursor-pointer transition-all duration-300 hover:bg-secondary/80 hover:shadow-lg", className)} {...props}>
            <CardHeader>
                <CardTitle className="flex items-center justify-center gap-2 py-6">
                    {room.icon && <DynamicIcon name={room.icon as IconName} className="size-12" />}
                </CardTitle>
                <CardFooter className="flex items-center justify-center ">
                    <h1 className="text-lg font-semibold">{room.name}</h1>
                </CardFooter>
            </CardHeader>
            {room.floor ? (
                <CardContent className="pt-0 text-center text-sm text-muted-foreground">
                    {room.floor}
                </CardContent>
            ) : null}
        </Card>
    )
}
