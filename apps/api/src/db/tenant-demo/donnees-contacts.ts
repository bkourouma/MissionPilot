import type { CleClient } from "./cles.js";

/*
 * Contacts des clients du cabinet « Tenant démo » : 2 ou 3 par client, dont un principal.
 * Noms africains francophones fictifs, e-mails en `.test` (jamais un vrai domaine), téléphones
 * fictifs.
 */

export interface DefContact {
  nom: string;
  fonction: string;
  email: string;
  telephone: string;
  principal: boolean;
}

export const CONTACTS: Record<CleClient, readonly DefContact[]> = {
  sicafe: [
    {
      nom: "Désiré Konan",
      fonction: "Directeur général",
      email: "d.konan@sicafe.tenant-demo.test",
      telephone: "+225 27 20 21 30 01",
      principal: true,
    },
    {
      nom: "Awa Coulibaly",
      fonction: "Directrice administrative et financière",
      email: "a.coulibaly@sicafe.tenant-demo.test",
      telephone: "+225 27 20 21 30 12",
      principal: false,
    },
    {
      nom: "Serge Yao",
      fonction: "Directeur des ressources humaines",
      email: "s.yao@sicafe.tenant-demo.test",
      telephone: "+225 27 20 21 30 25",
      principal: false,
    },
  ],
  "sicafe-transformation": [
    {
      nom: "Mariam Ouattara",
      fonction: "Directrice générale",
      email: "m.ouattara@sicafe-transformation.tenant-demo.test",
      telephone: "+225 27 21 27 44 02",
      principal: true,
    },
    {
      nom: "Jean-Marc Tanoh",
      fonction: "Directeur technique",
      email: "jm.tanoh@sicafe-transformation.tenant-demo.test",
      telephone: "+225 27 21 27 44 17",
      principal: false,
    },
  ],
  "sicafe-export": [
    {
      nom: "Ismaël Traoré",
      fonction: "Gérant",
      email: "i.traore@sicafe-export.tenant-demo.test",
      telephone: "+225 27 22 49 10 05",
      principal: true,
    },
    {
      nom: "Carine Kouassi",
      fonction: "Responsable administrative et financière",
      email: "c.kouassi@sicafe-export.tenant-demo.test",
      telephone: "+225 27 22 49 10 09",
      principal: false,
    },
  ],
  "brasseries-wouri": [
    {
      nom: "Emmanuel Nkoulou",
      fonction: "Directeur général",
      email: "e.nkoulou@brasseries-wouri.tenant-demo.test",
      telephone: "+237 233 42 18 00",
      principal: true,
    },
    {
      nom: "Hortense Fotso",
      fonction: "Directrice financière",
      email: "h.fotso@brasseries-wouri.tenant-demo.test",
      telephone: "+237 233 42 18 14",
      principal: false,
    },
    {
      nom: "Patrice Essomba",
      fonction: "Directeur des opérations",
      email: "p.essomba@brasseries-wouri.tenant-demo.test",
      telephone: "+237 233 42 18 27",
      principal: false,
    },
  ],
  "wouri-distribution": [
    {
      nom: "Brice Mbarga",
      fonction: "Gérant",
      email: "b.mbarga@wouri-distribution.tenant-demo.test",
      telephone: "+237 233 43 77 10",
      principal: true,
    },
    {
      nom: "Solange Tchamba",
      fonction: "Responsable commerciale",
      email: "s.tchamba@wouri-distribution.tenant-demo.test",
      telephone: "+237 233 43 77 22",
      principal: false,
    },
  ],
  "banque-sahel": [
    {
      nom: "Abdoulaye Compaoré",
      fonction: "Directeur général",
      email: "a.compaore@banque-sahel.tenant-demo.test",
      telephone: "+226 25 30 62 11",
      principal: true,
    },
    {
      nom: "Fatimata Zongo",
      fonction: "Directrice des risques et de la conformité",
      email: "f.zongo@banque-sahel.tenant-demo.test",
      telephone: "+226 25 30 62 20",
      principal: false,
    },
    {
      nom: "Boureima Kaboré",
      fonction: "Directeur des ressources humaines",
      email: "b.kabore@banque-sahel.tenant-demo.test",
      telephone: "+226 25 30 62 34",
      principal: false,
    },
  ],
  "teranga-logistique": [
    {
      nom: "Ousmane Thiam",
      fonction: "Directeur général",
      email: "o.thiam@teranga-logistique.tenant-demo.test",
      telephone: "+221 33 821 40 10",
      principal: true,
    },
    {
      nom: "Coumba Diop",
      fonction: "Directrice administrative et financière",
      email: "c.diop@teranga-logistique.tenant-demo.test",
      telephone: "+221 33 821 40 18",
      principal: false,
    },
  ],
  "baobab-assurances": [
    {
      nom: "Aminata Sarr",
      fonction: "Directrice générale",
      email: "a.sarr@baobab-assurances.tenant-demo.test",
      telephone: "+221 33 849 12 00",
      principal: true,
    },
    {
      nom: "Mor Gueye",
      fonction: "Directeur technique",
      email: "m.gueye@baobab-assurances.tenant-demo.test",
      telephone: "+221 33 849 12 09",
      principal: false,
    },
    {
      nom: "Nogaye Ba",
      fonction: "Directrice des ressources humaines",
      email: "n.ba@baobab-assurances.tenant-demo.test",
      telephone: "+221 33 849 12 31",
      principal: false,
    },
  ],
  "mboa-solaire": [
    {
      nom: "Cyrille Atangana",
      fonction: "Directeur général",
      email: "c.atangana@mboa-solaire.tenant-demo.test",
      telephone: "+237 222 20 51 08",
      principal: true,
    },
    {
      nom: "Rosine Ngo Bayiha",
      fonction: "Directrice technique",
      email: "r.ngobayiha@mboa-solaire.tenant-demo.test",
      telephone: "+237 222 20 51 15",
      principal: false,
    },
  ],
  "sahel-coton": [
    {
      nom: "Seydou Diarra",
      fonction: "Directeur général",
      email: "s.diarra@sahel-coton.tenant-demo.test",
      telephone: "+223 20 29 41 05",
      principal: true,
    },
    {
      nom: "Kadiatou Coulibaly",
      fonction: "Directrice financière",
      email: "k.coulibaly@sahel-coton.tenant-demo.test",
      telephone: "+223 20 29 41 13",
      principal: false,
    },
  ],
  "atlantique-retail": [
    {
      nom: "Camille Fontaine",
      fonction: "Directrice générale",
      email: "c.fontaine@atlantique-retail.tenant-demo.test",
      telephone: "+33 1 42 65 08 11",
      principal: true,
    },
    {
      nom: "Julien Marchetti",
      fonction: "Directeur administratif et financier",
      email: "j.marchetti@atlantique-retail.tenant-demo.test",
      telephone: "+33 1 42 65 08 24",
      principal: false,
    },
    {
      nom: "Sophie Lemaire",
      fonction: "Directrice des ressources humaines",
      email: "s.lemaire@atlantique-retail.tenant-demo.test",
      telephone: "+33 1 42 65 08 37",
      principal: false,
    },
  ],
  "gabon-offshore": [
    {
      nom: "Rodrigue Moussavou",
      fonction: "Directeur général",
      email: "r.moussavou@gabon-offshore.tenant-demo.test",
      telephone: "+241 01 72 33 40",
      principal: true,
    },
    {
      nom: "Prisca Nzamba",
      fonction: "Directrice financière",
      email: "p.nzamba@gabon-offshore.tenant-demo.test",
      telephone: "+241 01 72 33 52",
      principal: false,
    },
  ],
};
