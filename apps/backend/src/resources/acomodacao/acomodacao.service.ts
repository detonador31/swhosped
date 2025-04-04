/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateAcomodacaoDto } from './dto/create-acomodacao.dto';
import { UpdateAcomodacaoDto } from './dto/update-acomodacao.dto';
import { AcomodacaoFactory } from './../../database/seeders/acomodacao/acomodacao.factory';

import { EntityManager, raw, sql, wrap } from '@mikro-orm/postgresql';
import { Acomodacao } from './entities/acomodacao.entity';
import { Reserva, StatusReserva } from '../reserva/entities/reserva.entity';
import { FilterAcomodacaoDto } from './dto/filter-acomodacao.dto';
import { join } from 'path';
import { unlink } from 'fs/promises';

@Injectable()
export class AcomodacaoService {
  constructor(
    private readonly em: EntityManager,
    private readonly acomodacaoFactory: AcomodacaoFactory
  ) {}

  async create(
    createAcomodacaoDto: CreateAcomodacaoDto, 
    files: Array<Express.Multer.File> // Recebe array    
  ) {
    const imagePaths = files.map(file => file.path); // Extrai paths    
    const acomodacao = this.em.create(Acomodacao, {
      ...createAcomodacaoDto,
      imagens: imagePaths, // Armazena array de paths
    });

    await this.em.persistAndFlush(acomodacao);
    return acomodacao;
  }

  async findAllWithFilters(query: FilterAcomodacaoDto): Promise<{ 
    data: Acomodacao[], 
    totalItems: number, 
    totalPages: number, 
    currentPage: number 
  }> {
    const page  = query.page  && query.page > 0  ? query.page  : 1;  
    const limit = query.limit && query.limit > 0 ? query.limit : 21;
    const offset = (page - 1) * limit;
  
    // Definir alias explícito 'a' para a query principal
    const qb = this.em.createQueryBuilder(Acomodacao, 'a');
  
    // Aplicação dos filtros dinamicamente
    if (query.tipo) {
      qb.andWhere({ tipo: query.tipo });
    }
    if (query.capacidade) {
      qb.andWhere({ capacidade: { $gte: query.capacidade } });
    }
    if (query.precoMin !== undefined) {
      qb.andWhere({ precoPorNoite: { $gte: query.precoMin } });
    }
    if (query.precoMax !== undefined) {
      qb.andWhere({ precoPorNoite: { $lte: query.precoMax } });
    }
    if (query.cidade) {
      qb.andWhere({ cidade: query.cidade });
    }
    if (query.estado) {
      qb.andWhere({ estado: query.estado });
    }

    if(query.isPublic && query.isPublic === 'true') {
      qb.andWhere({ status: 'Disponível' });      
    }

    // Validação de datas
    if (query.checkin && query.checkout) {
      const checkin = new Date(query.checkin);
      const checkout = new Date(query.checkout);

      if (isNaN(checkin.getTime()) || isNaN(checkout.getTime())) {
        throw new BadRequestException('Formato de data inválido');
      }

      if (checkin >= checkout) {
        throw new BadRequestException('Check-in deve ser anterior ao check-out');
      }

      // Subconsulta com referência ao alias 'a'
      const subQuery = this.em.createQueryBuilder(Reserva, 'r')
        .select(sql`1`)
        .where('r.acomodacao_id = a.id') // Usando o alias 'a' definido na query principal
        .andWhere('r.data_check_in < ?', [checkout])
        .andWhere('r.data_check_out > ?', [checkin])
        .andWhere('r.status = ?', [StatusReserva.CONFIRMADA]);

      qb.andWhere(`NOT EXISTS (${subQuery.getFormattedQuery()})`);

    }
  
    // Obtendo os resultados e a contagem total
    const [data, totalItems] = await qb.limit(limit).offset(offset).getResultAndCount();
    const totalPages = Math.ceil(totalItems / limit);
  
    return {
      data,
      totalItems,
      totalPages,
      currentPage: page,
    };
  }
  
  findAll() {
    return `This action returns all acomodacao`;
  }

  findOne(id: number) {
    return `This action returns a #${id} acomodacao`;
  }

  async update(id: number, updateDto: UpdateAcomodacaoDto, newFiles: Express.Multer.File[] = []) {
    const acomodacao = await this.em.findOneOrFail(Acomodacao, id);
    wrap(acomodacao).assign(updateDto);
  
    // 1. Pegar todas as imagens atuais para deletar depois
    const currentImages = acomodacao.imagens || [];
    
    // 2. Limpar o array de imagens (todas serão substituídas)
    acomodacao.imagens = [];
  
    // 3. Adicionar apenas as novas imagens
    const newImagePaths = newFiles.map(file => file.path);
    acomodacao.imagens = [...newImagePaths];
  
    await this.em.persistAndFlush(acomodacao);
  
    // 4. Remover fisicamente as imagens antigas (opcional)
    if (currentImages.length > 0) {
      await this.deleteImageFiles(currentImages);
    }
  
    return acomodacao;
  }

  private async deleteImageFiles(imagePaths: string[]) {
    const deletePromises = imagePaths.map(async path => {
      try {
        const fullPath = join(process.cwd(), path);
        await unlink(fullPath);
      } catch (err) {
        console.error(`Erro ao deletar imagem ${path}:`, err);
      }
    });
    
    await Promise.all(deletePromises);
  }  

  async remove(id: number) {
    // 1. Encontra a acomodação com todas as relações necessárias
    const acomodacao = await this.em.findOne(Acomodacao, id);
    
    if (!acomodacao) {
      throw new NotFoundException(`Acomodação com ID ${id} não encontrada`);
    }
  
    // 2. Remove as imagens associadas do sistema de arquivos
    if (acomodacao.imagens && acomodacao.imagens.length > 0) {
      await this.deleteImageFiles(acomodacao.imagens);
    }
  
    // 3. Remove a entidade do banco de dados
    await this.em.removeAndFlush(acomodacao);
    
    return { message: `Acomodação com ID ${id} removida com sucesso` };
  }
}
