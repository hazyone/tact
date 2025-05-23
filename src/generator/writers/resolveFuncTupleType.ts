import { getType } from "@/types/resolveDescriptors";
import type { TypeDescription, TypeRef } from "@/types/types";
import type { WriterContext } from "@/generator/Writer";

export function resolveFuncTupleType(
    descriptor: TypeRef | TypeDescription | string,
    ctx: WriterContext,
): string {
    // String
    if (typeof descriptor === "string") {
        return resolveFuncTupleType(getType(ctx.ctx, descriptor), ctx);
    }

    // TypeRef
    if (descriptor.kind === "ref") {
        return resolveFuncTupleType(getType(ctx.ctx, descriptor.name), ctx);
    }
    if (descriptor.kind === "map") {
        return "cell";
    }
    if (descriptor.kind === "ref_bounced") {
        throw Error("Unimplemented");
    }
    if (descriptor.kind === "void") {
        return "()";
    }

    // TypeDescription
    if (descriptor.kind === "primitive_type_decl") {
        if (descriptor.name === "Int") {
            return "int";
        } else if (descriptor.name === "Bool") {
            return "int";
        } else if (descriptor.name === "Slice") {
            return "slice";
        } else if (descriptor.name === "Cell") {
            return "cell";
        } else if (descriptor.name === "Builder") {
            return "builder";
        } else if (descriptor.name === "Address") {
            return "slice";
        } else if (descriptor.name === "String") {
            return "slice";
        } else if (descriptor.name === "StringBuilder") {
            return "tuple";
        } else {
            throw Error("Unknown primitive type: " + descriptor.name);
        }
    } else if (descriptor.kind === "struct" || descriptor.kind === "contract") {
        return "tuple";
    }

    // Unreachable
    throw Error("Unknown type: " + descriptor.kind);
}
