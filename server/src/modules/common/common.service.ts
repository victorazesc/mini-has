import { Injectable, HttpException, HttpStatus } from "@nestjs/common";

@Injectable()
export class CommonService {
    constructor(
    ) { }


    notFound(detail: string): HttpException {
        return new HttpException({ detail }, HttpStatus.NOT_FOUND);
    }

    badRequest(detail: string): HttpException {
        return new HttpException({ detail }, HttpStatus.BAD_REQUEST);
    }

    messageFrom(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
