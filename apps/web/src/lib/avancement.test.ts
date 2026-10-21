import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import {
  AIDE_ENVOI_EMAIL,
  aucunRapportPortail,
  champsInitiaux,
  cheminApiListeAvancement,
  commentaireInitial,
  corpsModification,
  erreurLongueur,
  estConflitVersion,
  etatCommentaire,
  etatRapport,
  formaterAvancement,
  formaterValeurKpi,
  hrefAvancementMission,
  hrefRapportAvancement,
  hrefRapportPortail,
  libelleElements,
  libelleSemaineRapport,
  lireAvant,
  MENTION_VISIBILITE_CLIENT,
  messageAvancement,
  modifie,
  raisonValidationImpossible,
  resumeKpis,
  resumeLivrables,
  TAILLE_COMMENTAIRE_AVANCEMENT,
  TAILLE_INTRODUCTION_AVANCEMENT,
  type RapportAvancement,
} from "./avancement";

const ID = "3f2b8c1e-5d4a-4b6f-9e7d-1a2b3c4d5e6f";
const M = "7a1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e";

function rapport(surcharge: Partial<RapportAvancement> = {}): RapportAvancement {
  return {
    id: ID,
    mission_id: M,
    mission_intitule: "Plan stratégique",
    semaine: "2026-10-19",
    semaine_fin: "2026-10-25",
    statut: "brouillon",
    statut_libelle: "Brouillon",
    contenu: {} as RapportAvancement["contenu"],
    introduction: null,
    commentaire: null,
    commentaire_ia: null,
    statut_commentaire: "vide",
    statut_commentaire_libelle: "Aucun commentaire",
    version: 3,
    genere_le: "2026-10-20T08:00:00Z",
    modifie_le: "2026-10-20T08:00:00Z",
    valide_par: null,
    valide_le: null,
    peut_valider: true,
    ...surcharge,
  };
}

const erreur = (code: string, statut = 409) => new ErreurApi(code, "message brut", statut);

describe("chemins et liens", () => {
  it("liste paginée par semaine, lien de rapport et de portail", () => {
    expect(cheminApiListeAvancement(M)).toBe(`/api/missions/${M}/avancement?limite=26`);
    expect(cheminApiListeAvancement(M, "2026-09-28")).toBe(
      `/api/missions/${M}/avancement?limite=26&avant=2026-09-28`,
    );
    expect(hrefAvancementMission(M)).toBe(`/missions/${M}/avancement`);
    expect(hrefAvancementMission(M, "2026-09-28")).toBe(
      `/missions/${M}/avancement?avant=2026-09-28`,
    );
    expect(hrefRapportAvancement(M, ID)).toBe(`/missions/${M}/avancement/${ID}`);
    expect(hrefRapportPortail(ID)).toBe(`/portail/avancement/${ID}`);
  });

  it("le paramètre « avant » n'accepte qu'une date valide", () => {
    expect(lireAvant("2026-09-28")).toBe("2026-09-28");
    expect(lireAvant(["2026-09-28", "x"])).toBe("2026-09-28");
    expect(lireAvant("2026-02-31")).toBeNull();
    expect(lireAvant("n'importe quoi")).toBeNull();
    expect(lireAvant(undefined)).toBeNull();
  });
});

describe("libellés et formats", () => {
  it("semaine, avancement et éléments en français", () => {
    expect(libelleSemaineRapport({ semaine: "2026-10-05", semaine_fin: "2026-10-11" })).toBe(
      "Semaine du 5 au 11 octobre 2026",
    );
    expect(formaterAvancement(62)).toBe("62 %");
    expect(formaterAvancement(0)).toBe("0 %");
    expect(formaterAvancement(null)).toBe("Non calculé");
    expect(libelleElements(0)).toBe("Aucun élément");
    expect(libelleElements(1)).toBe("1 élément");
    expect(libelleElements(12)).toBe("12 éléments");
  });

  it("valeur de KPI avec unité, ou tiret si absente", () => {
    expect(formaterValeurKpi(null, "%")).toBe("—");
    expect(formaterValeurKpi(12.5, "jours")).toBe("12,5 jours");
    expect(formaterValeurKpi(3, "")).toBe("3");
  });

  it("résumés de KPI et de livrables accordés", () => {
    const k = { total: 0, vert: 0, orange: 0, rouge: 0, non_evalue: 0, elements: [] };
    expect(resumeKpis(k)).toBe("Aucun indicateur suivi");
    expect(resumeKpis({ ...k, total: 5, vert: 2, orange: 1, rouge: 1, non_evalue: 1 })).toBe(
      "2 dans la cible, 1 à surveiller, 1 hors cible, 1 non évalué",
    );
    const l = { total: 0, partages: 0, non_partages: 0, elements: [] };
    expect(resumeLivrables(l)).toBe("Aucun livrable");
    expect(resumeLivrables({ ...l, total: 3, partages: 2, non_partages: 1 })).toBe(
      "2 partagés avec le client sur 3",
    );
  });

  it("états : brouillon IA signalé, rédigé neutre, vide sans badge", () => {
    expect(etatRapport("valide")).toEqual({ libelle: "Validé", tonalite: "succes" });
    expect(etatRapport("brouillon").libelle).toBe("Brouillon");
    expect(etatCommentaire("brouillon_ia")).toEqual({
      libelle: "Brouillon IA à relire",
      tonalite: "attention",
    });
    expect(etatCommentaire("redige")?.tonalite).toBe("neutre");
    expect(etatCommentaire("vide")).toBeNull();
  });

  it("mentions de visibilité, d'envoi indisponible et d'état vide du portail", () => {
    expect(MENTION_VISIBILITE_CLIENT).toBe(
      "Le client ne voit ce rapport qu'une fois validé. Aucun e-mail n'est envoyé au client.",
    );
    expect(AIDE_ENVOI_EMAIL).toBe("Non disponible : aucun envoi automatique au client");
    expect(aucunRapportPortail.titre).not.toMatch(/IA|brouillon/i);
    expect(aucunRapportPortail.aide).not.toMatch(/IA|brouillon/i);
  });
});

describe("validation", () => {
  it("autorisée seulement pour un brouillon relu, enregistré, par une personne habilitée", () => {
    expect(raisonValidationImpossible(rapport(), false)).toBeNull();
    expect(raisonValidationImpossible(rapport({ statut_commentaire: "redige" }), false)).toBeNull();
  });

  it("refus expliqué : validé, non habilité, modifications en cours, commentaire IA à relire", () => {
    expect(raisonValidationImpossible(rapport({ statut: "valide" }), false)).toMatch(/déjà validé/);
    expect(raisonValidationImpossible(rapport({ peut_valider: false }), false)).toMatch(
      /associé, le directeur ou le chef/,
    );
    expect(raisonValidationImpossible(rapport(), true)).toMatch(/Enregistrez/);
    expect(
      raisonValidationImpossible(rapport({ statut_commentaire: "brouillon_ia" }), false),
    ).toMatch(/Relisez le commentaire proposé par l'IA/);
  });
});

describe("édition de l'introduction et du commentaire", () => {
  it("le commentaire proposé par l'IA pré-remplit la zone tant qu'il est à relire", () => {
    const ia = {
      commentaire: null,
      commentaire_ia: "Proposition",
      statut_commentaire: "brouillon_ia" as const,
    };
    expect(commentaireInitial(ia)).toBe("Proposition");
    expect(commentaireInitial({ ...ia, commentaire: "Mon texte" })).toBe("Mon texte");
    expect(commentaireInitial({ ...ia, statut_commentaire: "vide" })).toBe("");
    expect(champsInitiaux(rapport({ introduction: "Bonjour" }))).toEqual({
      introduction: "Bonjour",
      commentaire: "",
    });
  });

  it("le corps ne contient que les champs modifiés, avec la version lue", () => {
    const depart = { introduction: "A", commentaire: "B" };
    expect(corpsModification(depart, depart, 3)).toBeNull();
    expect(corpsModification(depart, { introduction: "A2", commentaire: "B" }, 3)).toEqual({
      version: 3,
      introduction: "A2",
    });
    expect(corpsModification(depart, { introduction: "A", commentaire: "" }, 3)).toEqual({
      version: 3,
      commentaire: "",
    });
  });

  it("relire sans changer envoie le commentaire tel quel", () => {
    const depart = { introduction: "", commentaire: "Proposition" };
    expect(corpsModification(depart, depart, 4, true)).toEqual({
      version: 4,
      commentaire: "Proposition",
    });
    expect(modifie(depart, depart)).toBe(false);
    expect(modifie(depart, { ...depart, introduction: "x" })).toBe(true);
  });

  it("limites de longueur du schéma partagé, signalées en français", () => {
    expect(TAILLE_INTRODUCTION_AVANCEMENT).toBe(2000);
    expect(TAILLE_COMMENTAIRE_AVANCEMENT).toBe(4000);
    expect(erreurLongueur("a".repeat(2000), TAILLE_INTRODUCTION_AVANCEMENT, "Introduction")).toBe(
      undefined,
    );
    expect(
      erreurLongueur("a".repeat(2001), TAILLE_INTRODUCTION_AVANCEMENT, "Introduction"),
    ).toMatch(/^Introduction : .*2.*001 caractères pour .*2.*000 au plus\.$/);
  });
});

describe("erreurs de l'API", () => {
  it("codes métier traduits en français, conflit de version reconnu", () => {
    expect(estConflitVersion(erreur("VERSION_CONFLIT"))).toBe(true);
    expect(estConflitVersion(erreur("RAPPORT_VALIDE"))).toBe(false);
    expect(estConflitVersion(new Error("x"))).toBe(false);
    expect(messageAvancement(erreur("VERSION_CONFLIT"))).toMatch(/Rechargez la dernière version/);
    expect(messageAvancement(erreur("RAPPORT_VALIDE"))).toMatch(/figé/);
    expect(messageAvancement(erreur("MISSION_NON_ACTIVE"))).toMatch(/ni signée ni en cours/);
    expect(messageAvancement(erreur("FONCTION_DESACTIVEE"))).toMatch(/désactivés/);
    expect(messageAvancement(erreur("COMMENTAIRE_IA_A_RELIRE"))).toMatch(/relu/);
  });

  it("autre erreur : message générique, jamais le texte brut d'une erreur inconnue", () => {
    expect(messageAvancement(new Error("boom"))).toMatch(/erreur inattendue/);
    expect(messageAvancement(erreur("AUTRE", 403))).toMatch(/rôle/);
  });
});
