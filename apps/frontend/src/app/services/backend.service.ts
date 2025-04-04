import { Injectable } from '@angular/core';
import { apiLinks } from '../shared/environment';

@Injectable({
  providedIn: 'root'
})
export class BackendService {
  apiLinks = apiLinks;

  // Usado para completar a url do servidor backend
  getServerUrl() {
    return apiLinks.devNetwork;
  }
}
