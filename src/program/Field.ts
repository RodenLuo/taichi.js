import type { SNodeTree } from './SNodeTree'
import { NativeTaichiAny, nativeTaichi } from "../native/taichi/GetTaichi"
import { MatrixType, PrimitiveType, StructType, Type, TypeCategory, TypeUtils, VectorType } from "../frontend/Type"
import { Program } from "./Program"
import { assert, error } from '../utils/Logging'
import { MultiDimensionalArray } from '../utils/MultiDimensionalArray'
import { elementToInt32Array, groupElements, reshape, toElement } from '../utils/Utils'

class Field {
    constructor(
        public snodeTree: SNodeTree,
        public offsetBytes: number,
        public sizeBytes: number,
        public dimensions: number[],
        public placeNodes: NativeTaichiAny[],
        public elementType: Type
    ) {

    }

    async toArray1D(): Promise<number[]> {
        if (TypeUtils.isTensorType(this.elementType)) {
            let copy = await Program.getCurrentProgram().runtime!.deviceToHost(this);
            if (TypeUtils.getPrimitiveType(this.elementType) === PrimitiveType.f32) {
                return copy.floatArray;
            }
            else {
                return copy.intArray;
            }
        }
        else {
            error("toArray1D can only be used for scalar/vector/matrix fields")
            return []
        }
    }

    private ensureMaterialized() {
        Program.getCurrentProgram().materializeCurrentTree()
    }

    async toArray(): Promise<any[]> {
        this.ensureMaterialized()
        let copy = await Program.getCurrentProgram().runtime!.deviceToHost(this);
        let elements1D = groupElements(copy.intArray, copy.floatArray, this.elementType)
        return reshape(elements1D, this.dimensions)
    }

    async get(indices: number[]): Promise<any> {
        this.ensureMaterialized()
        if (indices.length !== this.dimensions.length) {
            error(`indices dimensions mismatch, expecting ${this.dimensions.length}, received ${indices.length}`,)
        }
        for (let i = 0; i < indices.length; ++i) {
            assert(indices[i] < this.dimensions[i], "index out of bounds")
        }
        let index = 0;
        for (let i = 0; i < indices.length - 1; ++i) {
            index = (index + indices[i]) * this.dimensions[i + 1]
        }
        index += indices[indices.length - 1]
        let elementSizeBytes = this.elementType.getPrimitivesList().length * 4
        let offsetBytes = elementSizeBytes * index
        let copy = await Program.getCurrentProgram().runtime!.deviceToHost(this, offsetBytes, elementSizeBytes);
        return toElement(copy.intArray, copy.floatArray, this.elementType)
    }

    async fromArray1D(values: number[]) {
        assert(TypeUtils.isTensorType(this.elementType), "fromArray1D can only be used on fields of scalar/vector/matrix types")
        this.ensureMaterialized()
        assert(values.length * 4 === this.sizeBytes, "size mismatch")

        if (TypeUtils.getPrimitiveType(this.elementType) === PrimitiveType.i32) {
            let intArray = Int32Array.from(values)
            await Program.getCurrentProgram().runtime!.hostToDevice(this, intArray)
        }
        else {
            let floatArray = Float32Array.from(values)
            let intArray = new Int32Array(floatArray.buffer)
            await Program.getCurrentProgram().runtime!.hostToDevice(this, intArray)
        }
    }

    async fromArray(values: any) {
        this.ensureMaterialized()
        let curr = values
        for (let i = 0; i < this.dimensions.length; ++i) {
            if (!Array.isArray(curr)) {
                error("expecting array")
            }
            if (curr.length !== this.dimensions[i]) {
                error("array size mismatch")
            }
            curr = curr[0]
        }
        let values1D = values.flat(this.dimensions.length - 1)

        let int32Arrays: Int32Array[] = []
        // slow. hmm. fix later
        for (let val of values1D) {
            int32Arrays.push(elementToInt32Array(val, this.elementType))
        }

        let elementLength = int32Arrays[0].length
        let totalLength = int32Arrays.length * elementLength
        let result = new Int32Array(totalLength)
        for (let i = 0; i < int32Arrays.length; ++i) {
            result.set(int32Arrays[i], i * elementLength)
        }

        await Program.getCurrentProgram().runtime!.hostToDevice(this, result)
    }

    async set(indices: number[], value: any) {
        this.ensureMaterialized()
        if (indices.length !== this.dimensions.length) {
            error(`indices dimensions mismatch, expecting ${this.dimensions.length}, received ${indices.length}`,)
        }
        for (let i = 0; i < indices.length; ++i) {
            assert(indices[i] < this.dimensions[i], "index out of bounds")
        }
        let index = 0;
        for (let i = 0; i < indices.length - 1; ++i) {
            index = (index + indices[i]) * this.dimensions[i + 1]
        }
        index += indices[indices.length - 1]
        let elementSizeBytes = this.elementType.getPrimitivesList().length * 4
        let offsetBytes = elementSizeBytes * index

        let intArray = elementToInt32Array(value, this.elementType)
        await Program.getCurrentProgram().runtime!.hostToDevice(this, intArray, offsetBytes)
    }
}


interface TextureBase {
    getGPUTextureFormat() : GPUTextureFormat
    canUseAsRengerTarget(): boolean;
    getGPUTexture() : GPUTexture;
    textureId: number
}

class Texture implements TextureBase{
    constructor(
        public primitiveType: PrimitiveType,
        public numComponents:number,
        public dimensions: number[],
    ){
        assert(dimensions.length <= 3 && dimensions.length >= 1, "texture dimensions must be >= 1 and <= 3")
        assert(numComponents === 1 || numComponents === 2 || numComponents === 4 , "texture dimensions must be 1, 2, or 4")
        this.texture = Program.getCurrentProgram().runtime!.createGPUTexture(dimensions,this.getGPUTextureFormat(), this.canUseAsRengerTarget())
        this.textureId = Program.getCurrentProgram().runtime!.addTexture(this)
    }

    private texture:GPUTexture
    textureId: number

    getGPUTextureFormat() : GPUTextureFormat {
        switch(this.primitiveType){
            case PrimitiveType.f32:{
                switch(this.numComponents){
                    case 1: return "r32float"
                    case 2: return "rg32float"
                    case 4: return "rgba32float"
                }
            }
            case PrimitiveType.i32:{
                switch(this.numComponents){
                    case 1: return "r32sint"
                    case 2: return "rg32sint"
                    case 4: return "rgba32sint"
                }
            }
        }
        error("[Bug] format error")
        return 'rgba32float'
    }

    canUseAsRengerTarget(){
        return this.primitiveType === PrimitiveType.f32
    }
    
    getGPUTexture() : GPUTexture {
        return this.texture
    }
}

class CanvasTexture implements TextureBase{
    constructor(public htmlCanvas:HTMLCanvasElement){
        let contextAndFormat = Program.getCurrentProgram().runtime!.createGPUCanvasContext(htmlCanvas)
        this.context = contextAndFormat[0]
        this.format = contextAndFormat[1]
        this.textureId = Program.getCurrentProgram().runtime!.addTexture(this)
    }
    context:GPUCanvasContext
    format: GPUTextureFormat
    textureId: number

    getGPUTextureFormat() : GPUTextureFormat {
        return this.format
    }

    canUseAsRengerTarget(){
        return true
    }
    
    getGPUTexture() : GPUTexture {
        return this.context.getCurrentTexture()
    }
}

export { Field, TextureBase, Texture, CanvasTexture }