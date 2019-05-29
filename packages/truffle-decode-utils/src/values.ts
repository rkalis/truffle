import debugModule from "debug";
const debug = debugModule("decode-utils:values");

//objects for Solidity values

//Note: This is NOT intended to represent every possible value that exists
//in Solidity!  Only possible values of variables.  (Though there may be
//some expansion in the future.)  We do however count the builtin variables
//msg, block, and tx as variables (not other builtins though for now) so
//there is some support for the magic type.

//We don't include fixed and ufixed for now.  Those will be added when
//implemented.

//NOTE: not all of these optional fields are actually implemented. Some are
//just intended for the future.  More optional fields may be added in the
//future.

//Note: Many of the errors defined here deliberately *don't* extend Error.
//This is because their intended use is a little different.  Only the ones
//that are for throwing extend Error.

import BN from "bn.js";
import { Types } from "./types";
import util from "util";
import { AstDefinition } from "./ast";
import { Definition as DefinitionUtils } from "./definition";

export namespace Values {

  /*
   * SECTION 0: Some irrelevant stuff for dealing with util.inspect.custom.
   * You can probably ignore these.
   */

  //we'll need to write a typing for the options type ourself, it seems; just
  //going to include the relevant properties here
  interface InspectOptions {
    stylize?: (toMaybeColor: string, style?: string) => string;
    colors: boolean;
    breakLength: number;
  }

  //HACK -- inspect options are ridiculous, I swear >_>
  function cleanStylize(options: InspectOptions) {
    return Object.assign({}, ...Object.entries(options).map(
      ([key,value]) =>
        key === "stylize"
          ? {}
          : {[key]: value}
    ));
  }

  /*
   * SECTION 1: Generic types for values in general (including errors).
   */

  //This is the overall Value type.  It may encode an actual value (ValueProper) or
  //an error value (ValueError).  Every value has a type.
  //The reference field is for future use for encoding circular structures; you can
  //ignore it for now.
  //The nativize method is a HACK that you should not use except
  //A. for testing, or
  //B. if you really have to, which we unfortunately do in some cases.
  //See below for more.
  export abstract class Value {
    type: Types.Type;
    abstract nativize(): any; //HACK
    //turns Value objects into Plain-Old JavaScript Objects
    //May cause errors if numeric values are too big!
    //only use this in testing or if you have no better option!
  };

  //A ValueProper encodes an actual value, not an error.  HOWEVER, if it is a
  //container type (Array, Struct, or Mapping), it is still possible for some
  //of the individual values within it to be errors!
  //The exact type of the value field depends on the type of the Value; don't
  //worry, the more specific types will have more specific type annotations.
  export abstract class ValueProper extends Value {
    value: any; //sorry -- at least it's an abstract class though!
  };

  //A ValueError, on the other hand, encodes an error.  Rather than a value field,
  //it has an error field, of type ValueErrorDirect.
  //See section 2 regarding the toSoliditySha3Input method.
  export abstract class ValueError extends Value {
    error: ValueErrorDirect;
    [util.inspect.custom](depth: number | null, options: InspectOptions): string {
      return util.inspect(this.error, options);
    }
    toSoliditySha3Input(): {type: string; value: any} {
      return undefined; //will cause an error! should not occur!
    }
    nativize(): any {
      return undefined;
    }
  };

  //NOTE: the container types Array and Struct also potentially have another field,
  //reference.  This will be used in the future for circular values.

  //meanwhile, the underlying errors themselves come in two types:
  //1. errors that are specific to decoding a particular type, and
  //2. generic errors such as read errors.
  export type ValueErrorDirect = DecodeErrorDirect | GenericErrorDirect;

  //in fact, here's a subclass of ValueError just for holding those generic errors.
  export class GenericError extends ValueError {
    error: GenericErrorDirect;
    constructor(error: GenericErrorDirect) {
      super();
      this.error = error;
    }
  }

  //and here's the type definition for those errors themselves
  //See section 8 for the actual generic errors.
  export abstract class GenericErrorDirect {
    abstract message(): string;
    [util.inspect.custom](depth: number | null, options: InspectOptions): string {
      return this.message();
    }
  }

  //meanwhile, there are 5 types that can have (non-generic) errors occur
  //during their decoding
  //(FixedDecodingError covers both fixed and ufixed; it's only a temporary measure
  //so I figure it's OK)
  //WARNING: note the loss of the "Direct" suffix here; it was getting annoying
  //to add it everywhere.
  export type DecodeErrorDirect = BoolDecodingError | EnumDecodingError | FunctionInternalDecodingError | FixedDecodingError;

  //Finally, for when we need to throw an error, here's a wrapper class that extends Error.
  //Apologies about the confusing name, but I wanted something that would make
  //sense should it not be caught and thus accidentally exposed to the outside.
  export class DecodingError extends Error {
    error: GenericErrorDirect;
    constructor(error: GenericErrorDirect) {
      super(error.message());
      this.error = error;
      this.name = "DecodingError";
    }
  }

  /*
   * SECTION 2: Elementary values
   */

  //the type ElementaryValue will just be defined as a union type.  Again,
  //note this includes errors.
  export type ElementaryValue = UintValue | IntValue | BoolValue | BytesValue | AddressValue | StringValue | FixedValue | UfixedValue;

  //However, here's a class representing *proper* elementary values.
  //A key thing about elementary values is that they can be used as mapping keys,
  //and so they have a method that gives what input to soliditySha3() they correspond
  //to.  Note that errors, above, also have this method, but for them it just
  //returns undefined.
  export abstract class ElementaryValueProper extends ValueProper {
    abstract toSoliditySha3Input(): {type: string; value: any};
    toString(): string {
      return this.value.toString();
    }
  }

  //Uints
  export type UintValue = UintValueProper | GenericError;

  export class UintValueProper extends ElementaryValueProper {
    type: Types.UintType;
    value: BN;
    [util.inspect.custom](depth: number | null, options: InspectOptions): string {
      return options.stylize(this.value.toString(), "number");
    }
    toSoliditySha3Input() {
      return {
        type: "uint",
        value: this.value
      }
    }
    nativize() {
      return this.value.toNumber(); //beware!
    }
    constructor(uintType: Types.UintType, value: BN) {
      super();
      this.type = uintType;
      this.value = value;
    }
  }

  //Ints
  export type IntValue = IntValueProper | GenericError;

  export class IntValueProper extends ElementaryValueProper {
    type: Types.IntType;
    value: BN;
    [util.inspect.custom](depth: number | null, options: InspectOptions): string {
      return options.stylize(this.value.toString(), "number");
    }
    toSoliditySha3Input() {
      return {
        type: "int",
        value: this.value
      }
    }
    nativize() {
      return this.value.toNumber(); //beware!
    }
    constructor(intType: Types.IntType, value: BN) {
      super();
      this.type = intType;
      this.value = value;
    }
  }

  //Bools
  export type BoolValue = BoolValueProper | BoolValueError | GenericError;

  export class BoolValueProper extends ElementaryValueProper {
    type: Types.BoolType;
    value: boolean;
    [util.inspect.custom](depth: number | null, options: InspectOptions): string {
      return util.inspect(this.value, options);
    }
    toSoliditySha3Input() {
      return {
        type: "uint", //used to achieve left-padding
        value: this.value ? new BN(1) : new BN(0) //true & false won't work here
      }
    }
    nativize() {
      return this.value;
    }
    constructor(boolType: Types.BoolType, value: boolean) {
      super();
      this.type = boolType;
      this.value = value;
    }
  }

  //errors for bools
  export class BoolValueError extends ValueError {
    type: Types.BoolType;
    error: BoolDecodingError;
    constructor(boolType: Types.BoolType, error: BoolDecodingError) {
      super();
      this.type = boolType;
      this.error = error;
    }
  }

  export abstract class BoolDecodingError {
    raw: BN;
  }

  export class BoolOutOfRangeError extends BoolDecodingError {
    [util.inspect.custom](depth: number | null, options: InspectOptions): string {
      return `Invalid boolean (numeric value ${this.raw.toString()})`;
    }
    constructor(raw: BN) {
      super();
      this.raw = raw;
    }
  }

  //bytes
  export type BytesValue = BytesValueProper | GenericError;

  export class BytesValueProper extends ElementaryValueProper {
    type: Types.BytesType;
    value: string; //should be hex-formatted, with leading "0x"
    [util.inspect.custom](depth: number | null, options: InspectOptions): string {
      switch(this.type.kind) {
        case "static":
            return options.stylize(this.value, "number");
        case "dynamic":
            return options.stylize(`hex'${this.value.slice(2)}'`, "string")
      }
    }
    toSoliditySha3Input() {
      switch(this.type.kind) {
        case "static":
          return {
            type: "bytes32", //used to achieve right-padding
            value: this.value
          };
        case "dynamic":
          return {
            type: "bytes",
            value: this.value
          };
      }
    }
    nativize() {
      return this.value;
    }
    constructor(bytesType: Types.BytesType, value: string) {
      super();
      this.type = bytesType;
      this.value = value;
    }
  }

  //addresses
  export type AddressValue = AddressValueProper | GenericError;

  export class AddressValueProper extends ElementaryValueProper {
    type: Types.AddressType;
    value: string; //should have 0x and be checksum-cased
    [util.inspect.custom](depth: number | null, options: InspectOptions): string {
      return options.stylize(this.value, "number");
    }
    toSoliditySha3Input() {
      return {
        type: "uint", //used to achieve left-padding
        value: this.value
      }
    }
    nativize() {
      return this.value;
    }
    constructor(addressType: Types.AddressType, value: string) {
      super();
      this.type = addressType;
      this.value = value;
    }
  }

  //strings
  export type StringValue = StringValueProper | GenericError;

  export class StringValueProper extends ElementaryValueProper {
    type: Types.StringType;
    value: string;
    [util.inspect.custom](depth: number | null, options: InspectOptions): string {
      return util.inspect(this.value, options);
    }
    toSoliditySha3Input() {
      return {
        type: "string",
        value: this.value
      }
    }
    nativize() {
      return this.value;
    }
    constructor(stringType: Types.StringType, value: string) {
      super();
      this.type = stringType;
      this.value = value;
    }
  }

  //Fixed & Ufixed
  //These don't have a value format yet, so they just decode to errors for now!
  export type FixedValue = FixedValueError;
  export type UfixedValue = UfixedValueError;

  export class FixedValueError extends ValueError {
    type: Types.FixedType;
    error: FixedDecodingError;
    constructor(dataType: Types.FixedType, raw: BN) {
      super();
      this.type = dataType;
      this.error = new FixedDecodingError(raw);
    }
  }

  export class UfixedValueError extends ValueError {
    type: Types.UfixedType;
    error: FixedDecodingError;
    constructor(dataType: Types.UfixedType, raw: BN) {
      super();
      this.type = dataType;
      this.error = new FixedDecodingError(raw);
    }
  }

  //not distinguishing fixed vs ufixed here
  export class FixedDecodingError {
    raw: BN;
    [util.inspect.custom](depth: number | null, options: InspectOptions): string {
      return `Fixed-point decoding not yet supported (raw value: ${this.raw.toString()})`;
    }
    constructor(raw: BN) {
      this.raw = raw;
    }
  }

  //Function for wrapping a value as an ElementaryValueProper
  //WARNING: this function does not check its inputs! Please check before using!
  //How to use:
  //numbers may be BN, number, or numeric string
  //strings should be given as strings. duh.
  //bytes should be given as hex strings beginning with "0x"
  //addresses are like bytes; checksum case is not required
  //booleans may be given either as booleans, or as string "true" or "false"
  export function wrapElementaryValue(value: any, definition: AstDefinition): ElementaryValueProper {
    let dataType = Types.definitionToType(definition, null); //force location to undefined
    switch(dataType.typeClass) {
      case "string":
        return new StringValueProper(dataType, value);
      case "bytes":
        return new BytesValueProper(dataType, value);
      case "address":
        return new AddressValueProper(dataType, value);
      case "int":
        if(value instanceof BN) {
          value = value.clone();
        }
        else {
          value = new BN(value);
        }
        return new IntValueProper(dataType, value);
      case "uint":
        if(value instanceof BN) {
          value = value.clone();
        }
        else {
          value = new BN(value);
        }
        return new UintValueProper(dataType, value);
      case "bool":
        if(typeof value === "string") {
          value = value !== "false";
        }
        return new BoolValueProper(dataType, value);
    }
  }

  /*
   * SECTION 3: CONTAINER TYPES (including magic)
   */

  //this function will be used in the future for displaying circular
  //structures
  function formatCircular(loopLength: number, options: InspectOptions) {
    return options.stylize(`[Circular (=up ${this.loopLength})]`, "special");
  }

  //Arrays
  export type ArrayValue = ArrayValueProper | GenericError;

  export class ArrayValueProper extends ValueProper {
    type: Types.ArrayType;
    reference?: number; //will be used in the future for circular values
    value: Value[];
    [util.inspect.custom](depth: number | null, options: InspectOptions): string {
      if(this.reference !== undefined) {
        return formatCircular(this.reference, options);
      }
      return util.inspect(this.value, options)
    }
    nativize() {
      return this.value.map(element => element.nativize());
    }
    constructor(arrayType: Types.ArrayType, value: Value[], reference?: number) {
      super();
      this.type = arrayType;
      this.value = value;
      this.reference = reference;
    }
  }

  //Mappings
  export type MappingValue = MappingValueProper | GenericError;

  export class MappingValueProper extends ValueProper {
    type: Types.MappingType;
    //note that since mappings live in storage, a circular
    //mapping is impossible
    value: [ElementaryValueProper, Value][]; //order of key-value pairs is irrelevant
    [util.inspect.custom](depth: number | null, options: InspectOptions): string {
      return util.inspect(new Map(this.value), options);
    }
    nativize() {
      //if only I could use Object.fromEntries() here!
      return Object.assign({}, ...this.value.map(([key, value]) =>
        ({[key.toString()]: value.nativize()})
      ));
    }
    constructor(mappingType: Types.MappingType, value: [ElementaryValueProper, Value][]) {
      super();
      this.type = mappingType;
      this.value = value;
    }
  }

  //Structs
  export type StructValue = StructValueProper | GenericError;

  export class StructValueProper extends ValueProper {
    type: Types.StructType;
    reference?: number; //will be used in the future for circular values
    value: {
      [field: string]: Value;
    };
    [util.inspect.custom](depth: number | null, options: InspectOptions): string {
      if(this.reference !== undefined) {
        return formatCircular(this.reference, options);
      }
      return util.inspect(this.value, options);
    }
    nativize() {
      return Object.assign({}, ...Object.entries(this.value).map(
        ([key, value]) => ({[key]: value.nativize()})
      ));
    }
    constructor(structType: Types.StructType, value: {[field: string]: Value}, reference?: number) {
      super();
      this.type = structType;
      this.value = value;
      this.reference = reference;
    }
  }

  //Magic variables
  export type MagicValue = MagicValueProper | GenericError;

  export class MagicValueProper extends ValueProper {
    type: Types.MagicType;
    //a magic variable can't be circular, duh!
    value: {
      [field: string]: Value
    };
    [util.inspect.custom](depth: number | null, options: InspectOptions): string {
      return util.inspect(this.value, options);
    }
    nativize() {
      return Object.assign({}, ...Object.entries(this.value).map(
        ([key, value]) => ({[key]: value.nativize()})
      ));
    }
    constructor(magicType: Types.MagicType, value: {[field: string]: Value}) {
      super();
      this.type = magicType;
      this.value = value;
    }
  }


  /*
   * SECTION 4: ENUMS
   * (they didn't fit anywhere else :P )
   */

  //Enums
  export type EnumValue = EnumValueProper | EnumValueError | GenericError;

  export class EnumValueProper extends ValueProper {
    type: Types.EnumType;
    value: {
      name: string;
      numeric: BN;
    };
    fullName(): string {
      return `${this.type.definingContractName}.${this.type.typeName}.${this.value.name}`;
    }
    [util.inspect.custom](depth: number | null, options: InspectOptions): string {
      return this.fullName();
    }
    nativize() {
      return this.fullName();
    }
    constructor(enumType: Types.EnumType, numeric: BN, name: string) {
      super();
      this.type = enumType;
      this.value = { name, numeric };
    }
  };

  //Enum errors
  export class EnumValueError extends ValueError {
    type: Types.EnumType;
    error: EnumDecodingError;
    constructor(enumType: Types.EnumType, error: EnumDecodingError) {
      super();
      this.type = enumType;
      this.error = error;
    }
  };

  export abstract class EnumDecodingError {
    type: Types.EnumType;
    raw: BN;
  }

  export class EnumOutOfRangeError extends EnumDecodingError {
    [util.inspect.custom](depth: number | null, options: InspectOptions): string {
      let typeName = this.type.definingContractName + "." + this.type.typeName;
      return `Invalid ${typeName} (numeric value ${this.raw.toString()})`;
    }
    constructor(enumType: Types.EnumType, raw: BN) {
      super();
      this.type = enumType;
      this.raw = raw;
    }
  }

  export class EnumNotFoundDecodingError extends EnumDecodingError {
    [util.inspect.custom](depth: number | null, options: InspectOptions): string {
      let typeName = this.type.definingContractName + "." + this.type.typeName;
      return `Unknown enum type ${typeName} of id ${this.type.id} (numeric value ${this.raw.toString()})`;
    }
    constructor(enumType: Types.EnumType, raw: BN) {
      super();
      this.type = enumType;
      this.raw = raw;
    }
  }

  /*
   * SECTION 5: CONTRACTS
   */

  //Contracts
  export type ContractValue = ContractValueProper | GenericError;

  //Contract values have a special new type as their value: ContractValueDirect.
  export class ContractValueProper extends ValueProper {
    type: Types.ContractType;
    value: ContractValueDirect;
    [util.inspect.custom](depth: number | null, options: InspectOptions): string {
      return util.inspect(this.value, options);
    }
    nativize() {
      return this.value.nativize();
    }
    constructor(contractType: Types.ContractType, value: ContractValueDirect) {
      super();
      this.type = contractType;
      this.value = value;
    }
  }

  //There are two types -- one for contracts whose class we can identify, and one
  //for when we can't identify the class.
  export type ContractValueDirect = ContractValueDirectKnown | ContractValueDirectUnknown;

  //when we can identify the class
  export class ContractValueDirectKnown {
    address: string; //should be formatted as address
    //NOT an AddressValue, note
    kind: "known";
    class: Types.ContractType;
    //may have more optional members defined later, but I'll leave these out for now
    [util.inspect.custom](depth: number | null, options: InspectOptions): string {
      return options.stylize(this.address, "number") + ` (${this.class.typeName})`;
    }
    nativize() {
      return `${this.class.typeName}(${this.address})`;
    }
    constructor(address: string, contractClass: Types.ContractType) {
      this.kind = "known";
      this.address = address;
      this.class = contractClass;
    }
  }

  //when we can't
  export class ContractValueDirectUnknown {
    address: string; //should be formatted as address
    //NOT an AddressValue, note
    kind: "unknown";
    [util.inspect.custom](depth: number | null, options: InspectOptions): string {
      debug("options: %O", options);
      return options.stylize(this.address, "number") + " of unknown class";
    }
    nativize() {
      return this.address;
    }
    constructor(address: string) {
      this.kind = "unknown";
      this.address = address;
    }
  }

  /*
   * SECTION 6: External functions
   */

  //functions can be external or internal, but let's include this union type here
  export type FunctionValue = FunctionValueExternal | FunctionValueInternal;

  //External functions
  export type FunctionValueExternal = FunctionValueExternalProper | GenericError;

  //External function values come in 3 types:
  export type FunctionValueExternalProper =
    FunctionValueExternalProperKnown //it's a known function of a known class
    | FunctionValueExternalProperInvalid //known class but can't locate function
    | FunctionValueExternalProperUnknown; //don't even know the class

  //known function of known class
  export class FunctionValueExternalProperKnown extends ValueProper {
    type: Types.FunctionType; //should be external, obviously
    value: {
      kind: "known";
      contract: ContractValueDirectKnown;
      selector: string; //formatted as a bytes4
      name: string;
    };
    [util.inspect.custom](depth: number | null, options: InspectOptions): string {
      //first, let's inspect that contract, but w/o color
      let contractString = util.inspect(this.value.contract, { ...cleanStylize(options), colors: false });
      let firstLine = `[Function: ${this.value.name} of`;
      let secondLine = `${contractString}]`;
      let breakingSpace = firstLine.length >= options.breakLength ? "\n" : " ";
      //now, put it together
      return options.stylize(firstLine + breakingSpace + secondLine, "special");
    }
    nativize() {
      return `${this.value.contract.nativize()}.${this.value.name}`
    }
    constructor(functionType: Types.FunctionType, contract: ContractValueDirectKnown, selector: string, name: string) {
      super();
      this.type = functionType;
      this.value = { contract, selector, name, kind: "known" };
    }
  }

  //known class but can't locate function
  export class FunctionValueExternalProperInvalid extends ValueProper {
    type: Types.FunctionType; //should be external, obviously
    value: {
      kind: "invalid";
      contract: ContractValueDirectKnown;
      selector: string; //formatted as a bytes4
    };
    [util.inspect.custom](depth: number | null, options: InspectOptions): string {
      //first, let's inspect that contract, but w/o color
      let contractString = util.inspect(this.value.contract, { ...cleanStylize(options), colors: false });
      let selectorString = `Unknown selector 0x${this.value.selector}`;
      let firstLine = `[Function: ${selectorString} of`;
      let secondLine = `${contractString}]`;
      let breakingSpace = firstLine.length >= options.breakLength ? "\n" : " ";
      //now, put it together
      return options.stylize(firstLine + breakingSpace + secondLine, "special");
    }
    nativize() {
      return `${this.value.contract.nativize()}.call(${this.value.selector}...)`
    }
    constructor(functionType: Types.FunctionType, contract: ContractValueDirectKnown, selector: string) {
      super();
      this.type = functionType;
      this.value = { contract, selector, kind: "invalid" };
    }
  }

  //can't even locate class
  export class FunctionValueExternalProperUnknown extends ValueProper {
    type: Types.FunctionType; //should be external, obviously
    value: {
      kind: "unknown";
      contract: ContractValueDirectUnknown;
      selector: string; //formatted as a bytes4
    };
    [util.inspect.custom](depth: number | null, options: InspectOptions): string {
      //first, let's inspect that contract, but w/o color
      let contractString = util.inspect(this.value.contract, { ...cleanStylize(options), colors: false });
      let selectorString = `Unknown selector 0x${this.value.selector}`;
      let firstLine = `[Function: ${selectorString} of`;
      let secondLine = `${contractString}]`;
      let breakingSpace = firstLine.length >= options.breakLength ? "\n" : " ";
      //now, put it together
      return options.stylize(firstLine + breakingSpace + secondLine, "special");
    }
    nativize() {
      return `${this.value.contract.nativize()}.call(${this.value.selector}...)`
    }
    constructor(functionType: Types.FunctionType, contract: ContractValueDirectUnknown, selector: string) {
      super();
      this.type = functionType;
      this.value = { contract, selector, kind: "unknown" };
    }
  }

  /*
   * SECTION 7: INTERNAL FUNCTIONS
   */

  //Internal functions
  export type FunctionValueInternal = FunctionValueInternalProper | FunctionValueInternalError | GenericError;

  //Internal function values (proper) come in 3 types:
  export type FunctionValueInternalProper = 
    | FunctionValueInternalProperKnown //valid function;
    | FunctionValueInternalProperException //default value (not a real function);
    | FunctionValueInternalProperUnknown //value returne to indicate that decoding is not supported outside of debugger.

  //actual function
  export class FunctionValueInternalProperKnown extends ValueProper {
    type: Types.FunctionType; //should be internal, obviously
    value: {
      kind: "function"
      context: Types.ContractType;
      deployedProgramCounter: number;
      constructorProgramCounter: number;
      name: string;
      definedIn: Types.ContractType;
    };
    [util.inspect.custom](depth: number | null, options: InspectOptions): string {
      return options.stylize(`[Function: ${this.value.definedIn.typeName}.${this.value.name}]`, "special");
    }
    nativize() {
      return `${this.value.definedIn.typeName}.${this.value.name}`;
    }
    constructor(
      functionType: Types.FunctionType,
      context: Types.ContractType,
      deployedProgramCounter: number,
      constructorProgramCounter: number,
      name: string,
      definedIn: Types.ContractType
    ) {
      super();
      this.type = functionType;
      this.value = {
        context,
        deployedProgramCounter,
        constructorProgramCounter,
        name,
        definedIn,
        kind: "function"
      };
    }
  }

  //default value
  export class FunctionValueInternalProperException extends ValueProper {
    type: Types.FunctionType; //should be internal, obviously
    value: {
      kind: "exception"
      context: Types.ContractType;
      deployedProgramCounter: number;
      constructorProgramCounter: number;
    };
    [util.inspect.custom](depth: number | null, options: InspectOptions): string {
      return this.value.deployedProgramCounter === 0
        ? options.stylize(`[Function: <zero>]`, "special")
        : options.stylize(`[Function: assert(false)]`, "special");
    }
    nativize() {
      return this.value.deployedProgramCounter === 0
        ? `<zero>`
        : `assert(false)`;
    }
    constructor(
      functionType: Types.FunctionType,
      context: Types.ContractType,
      deployedProgramCounter: number,
      constructorProgramCounter: number
    ) {
      super();
      this.type = functionType;
      this.value = { context, deployedProgramCounter, constructorProgramCounter, kind: "exception" };
    }
  }

  //value returned to indicate that decoding is not supported outside the debugger
  export class FunctionValueInternalProperUnknown extends ValueProper {
    type: Types.FunctionType; //should be internal, obviously
    value: {
      kind: "unknown"
      context: Types.ContractType;
      deployedProgramCounter: number;
      constructorProgramCounter: number;
    };
    [util.inspect.custom](depth: number | null, options: InspectOptions): string {
      return options.stylize(`[Function: decoding not supported (raw info: deployed PC=${this.value.deployedProgramCounter}, constructor PC=${this.value.constructorProgramCounter})]`, "special");
    }
    nativize() {
      return `<decoding not supported>`;
    }
    constructor(
      functionType: Types.FunctionType,
      context: Types.ContractType,
      deployedProgramCounter: number,
      constructorProgramCounter: number
    ) {
      super();
      this.type = functionType;
      this.value = { context, deployedProgramCounter, constructorProgramCounter, kind: "unknown" };
    }
  }

  //Internal function errors
  export class FunctionValueInternalError extends ValueError {
    type: Types.FunctionType; //should be internal, obviously
    error: FunctionInternalDecodingError;
    constructor(functionType: Types.FunctionType, error: FunctionInternalDecodingError) {
      super();
      this.type = functionType;
      this.error = error;
    }
  }

  export abstract class FunctionInternalDecodingError {
    context: Types.ContractType;
    deployedProgramCounter: number;
    constructorProgramCounter: number;
  }

  export class NoSuchInternalFunctionError extends FunctionInternalDecodingError {
    [util.inspect.custom](depth: number | null, options: InspectOptions): string {
      return `Invalid function (Deployed PC=${this.deployedProgramCounter}, constructor PC=${this.constructorProgramCounter}) of contract ${this.context.typeName}`;
    }
    constructor(context: Types.ContractType, deployedProgramCounter: number, constructorProgramCounter: number) {
      super();
      this.context = context;
      this.deployedProgramCounter = deployedProgramCounter;
      this.constructorProgramCounter = constructorProgramCounter;
    }
  }

  export class DeployedFunctionInConstructorError extends FunctionInternalDecodingError {
    [util.inspect.custom](depth: number | null, options: InspectOptions): string {
      return `Deployed-style function (PC=${this.deployedProgramCounter}) in constructor`;
    }
    constructor(context: Types.ContractType, deployedProgramCounter: number) {
      super();
      this.context = context;
      this.deployedProgramCounter = deployedProgramCounter;
      this.constructorProgramCounter = 0;
    }
  }

  export class MalformedInternalFunctionError extends FunctionInternalDecodingError {
    [util.inspect.custom](depth: number | null, options: InspectOptions): string {
      return `Malformed internal function w/constructor PC only (value: ${this.constructorProgramCounter})`;
    }
    constructor(context: Types.ContractType, constructorProgramCounter: number) {
      super();
      this.context = context;
      this.deployedProgramCounter = 0;
      this.constructorProgramCounter = constructorProgramCounter;
    }
  }

  /*
   * SECTION 8: GENERIC ERRORS
   */

  //type-location error
  export class UserDefinedTypeNotFoundError extends GenericErrorDirect {
    type: Types.UserDefinedType;
    message() {
      let typeName = Types.isContractDefinedType(this.type)
        ? this.type.definingContractName + "." + this.type.typeName
        : this.type.typeName;
      return `Unknown ${this.type.typeClass} type ${typeName} of id ${this.type.id}`;
    }
    constructor(unknownType: Types.UserDefinedType) {
      super();
      this.type = unknownType;
    }
  }

  //Read errors
  export class UnsupportedConstantError extends GenericErrorDirect {
    definition: AstDefinition;
    message() {
      return `Unsupported constant type ${DefinitionUtils.typeClass(this.definition)}$`;
    }
    constructor(definition: AstDefinition) {
      super();
      this.definition = definition;
    }
  }

  export class ReadErrorStack extends GenericErrorDirect {
    from: number;
    to: number;
    message() {
      return `Can't read stack from position ${this.from} to ${this.to}`;
    }
    constructor(from: number, to: number) {
      super();
      this.from = from;
      this.to = to;
    }
  }
}