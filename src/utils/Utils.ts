import { MatrixType, PrimitiveType, StructType, Type, TypeCategory, TypeUtils, VectorType } from "../frontend/Type";
import { assert, error } from "./Logging";
import { MultiDimensionalArray } from "./MultiDimensionalArray";

export function divUp(a: number, b: number) {
    return Math.ceil(a / b)
}

export function nextPowerOf2(n: number) {
    let count = 0

    if (n && !(n & (n - 1)))
        return n;

    while (n != 0) {
        n >>= 1;
        count += 1;
    }

    return 1 << count;
}


export function groupByN<T>(arr: T[], n: number): T[][] {
    let result: T[][] = []
    let current: T[] = []
    for (let i = 0; i < arr.length; ++i) {
        current.push(arr[i])
        if (current.length === n) {
            result.push(current)
            current = []
        }
    }
    return result
}

export function toTensorElement(intArray: number[], floatArray: number[], elementType: Type): any {
    let selectedArray = intArray
    if (TypeUtils.getPrimitiveType(elementType) === PrimitiveType.f32) {
        selectedArray = floatArray
    }
    if (elementType.getCategory() === TypeCategory.Scalar) {
        return selectedArray[0]
    }
    else if (elementType.getCategory() === TypeCategory.Vector) {
        return selectedArray
    }
    else if (elementType.getCategory() === TypeCategory.Matrix) {
        let matType = elementType as MatrixType
        return groupByN(selectedArray, matType.getNumCols())
    }
    else {
        error("expecting tensor type")
        return []
    }
}

export function toStructElement(intArray: number[], floatArray: number[], elementType: StructType): any {
    let result: any = {}
    for (let k of elementType.getPropertyNames()) {
        let offset = elementType.getPropertyPrimitiveOffset(k)
        let propType = elementType.getPropertyType(k)
        let length = propType.getPrimitivesList().length
        let thisProp = toElement(intArray.slice(offset, offset + length), floatArray.slice(offset, offset + length), propType)
        result[k] = thisProp
    }
    return result
}

export function toElement(intArray: number[], floatArray: number[], elementType: Type): any {
    if (TypeUtils.isTensorType(elementType)) {
        return toTensorElement(intArray, floatArray, elementType)
    }
    if (elementType.getCategory() === TypeCategory.Struct) {
        return toStructElement(intArray, floatArray, elementType as StructType)
    }
    else {
        error("unsupported element type")
        return []
    }
}

export function int32ArrayToElement(int32Array: Int32Array, elementType: Type): any {
    let float32Array = new Float32Array(int32Array.buffer)
    let intArray = Array.from(int32Array)
    let floatArray = Array.from(float32Array)
    return toElement(intArray, floatArray, elementType)
}

export function groupElements(intArray: number[], floatArray: number[], elementType: Type): any[] {
    let N = elementType.getPrimitivesList().length
    let intArrays = groupByN(intArray, N)
    let floatArrays = groupByN(floatArray, N)
    let result: any[] = []
    for (let i = 0; i < intArrays.length; ++i) {
        result.push(toElement(intArrays[i], floatArrays[i], elementType))
    }
    return result
}

export function reshape<T>(elements: T[], dimensions: number[]): MultiDimensionalArray<T> {
    let result: MultiDimensionalArray<T> = elements
    for (let i = dimensions.length - 1; i > 0; --i) {
        let thisDim = dimensions[i]
        result = groupByN<T>(result as ((typeof result[0])[]), thisDim)
    }
    return result
}

export function tensorToNumberArray(tensorValue: number | number[] | number[][], tensorType: Type): number[] {
    if (tensorType.getCategory() === TypeCategory.Scalar) {
        assert(typeof tensorValue === "number", "expecting number")
        return [tensorValue as number]
    }
    else if (tensorType.getCategory() === TypeCategory.Vector) {
        assert(Array.isArray(tensorValue), "expecting array")
        let vec = tensorValue as number[]
        assert(typeof vec[0] === "number", "expecting 1d number array")
        assert(vec.length === (tensorType as VectorType).getNumRows(), "num rows mismatch")
        return vec
    }
    else if (tensorType.getCategory() === TypeCategory.Matrix) {
        assert(Array.isArray(tensorValue) && Array.isArray(tensorValue[0]), "expecting 2d array")
        let mat = tensorValue as number[][]
        assert(typeof mat[0][0] === "number", "expecting 2d number array")
        let matType = tensorType as MatrixType
        assert(mat.length === matType.getNumRows() && mat[0].length === matType.getNumCols(), "matrix shape mismatch")
        let result: number[] = []
        for (let vec of (tensorValue as number[][])) {
            result = result.concat(vec)
        }
        return result
    }
    else {
        error("expecting tensor type")
        return []
    }
}

export function tensorToInt32Array(tensorValue: number | number[] | number[][], tensorType: Type): Int32Array {
    let numberArray = tensorToNumberArray(tensorValue, tensorType)
    if (TypeUtils.getPrimitiveType(tensorType) === PrimitiveType.i32) {
        return Int32Array.from(numberArray)
    }
    else { // f32, do a reinterpret cast
        let f32Array = Float32Array.from(numberArray)
        return new Int32Array(f32Array.buffer)
    }
}

export function structToInt32Array(val: any, structType: StructType): Int32Array {
    let prims = structType.getPrimitivesList()
    let result = new Int32Array(prims.length)
    for (let k of structType.getPropertyNames()) {
        if (val[k] === undefined) {
            error("missing property: ", k)
        }
        let offset = structType.getPropertyPrimitiveOffset(k)
        let propType = structType.getPropertyType(k)
        let propResult = elementToInt32Array(val[k], propType)
        result.set(propResult, offset)
    }
    return result
}

export function elementToInt32Array(element: any, elementType: Type): Int32Array {
    if (TypeUtils.isTensorType(elementType)) {
        return tensorToInt32Array(element, elementType)
    }
    else if (elementType.getCategory() === TypeCategory.Struct) {
        return structToInt32Array(element, elementType as StructType)
    }
    else {
        error("unsupported field element type")
        return Int32Array.from([])
    }
}
