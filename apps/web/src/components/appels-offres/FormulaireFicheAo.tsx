"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "../../lib/api";
import {
  analyserImportCsv,
  hrefFiche,
  messageAo,
  SAISIE_FICHE_VIDE,
  validerFiche,
  type FicheAo,
  type SaisieFiche,
} from "../../lib/appels-offres";
import { DEVISES, type Devise } from "../../lib/format";
import { aideMontant } from "../../lib/saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

/**
 * Saisie manuelle d'une fiche d'appel d'offres (AO-01) : aucune veille automatique, aucun
 * connecteur. Le rapprochement avec le profil du cabinet est calculé par l'API à l'enregistrement.
 */
export function FormulaireFicheAo() {
  const router = useRouter();
  const f = useFormulaire<keyof SaisieFiche>();
  const [s, setS] = useState<SaisieFiche>(SAISIE_FICHE_VIDE);
  const maj = (c: Partial<SaisieFiche>) => setS((x) => ({ ...x, ...c }));
  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        await f.envoyer(validerFiche(s), (c) => api.post<FicheAo>("/api/appels-offres", c), {
          messageSpecifique: messageAo,
          rafraichir: false,
          apres: (r) => router.push(hrefFiche(r.id)),
        });
      }}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur="Enregistrement impossible"
      />
      <Champ
        libelle="Intitulé"
        required
        maxLength={300}
        value={s.titre}
        onChange={(e) => maj({ titre: e.target.value })}
        erreur={f.erreurs.titre}
      />
      <div className="mp-grille-champs">
        <Champ
          libelle="Référence de l'avis"
          maxLength={80}
          value={s.reference}
          onChange={(e) => maj({ reference: e.target.value })}
          erreur={f.erreurs.reference}
        />
        <Champ
          libelle="Bailleur"
          maxLength={150}
          value={s.bailleur}
          onChange={(e) => maj({ bailleur: e.target.value })}
          erreur={f.erreurs.bailleur}
        />
        <Champ
          libelle="Pays (code)"
          maxLength={2}
          value={s.pays}
          onChange={(e) => maj({ pays: e.target.value })}
          erreur={f.erreurs.pays}
          aide="Deux lettres : CI, SN, BF…"
        />
        <Champ
          libelle="Secteur"
          maxLength={120}
          value={s.secteur}
          onChange={(e) => maj({ secteur: e.target.value })}
          erreur={f.erreurs.secteur}
        />
        <Champ
          libelle="Montant estimé"
          inputMode="decimal"
          value={s.montant}
          onChange={(e) => maj({ montant: e.target.value })}
          erreur={f.erreurs.montant}
          aide={aideMontant(s.devise)}
        />
        <Select
          libelle="Devise"
          value={s.devise}
          onChange={(e) => maj({ devise: e.target.value as Devise })}
          options={DEVISES.map((d) => ({ valeur: d, libelle: d }))}
        />
        <Champ
          libelle="Date limite de dépôt"
          type="date"
          value={s.date_limite}
          onChange={(e) => maj({ date_limite: e.target.value })}
          erreur={f.erreurs.date_limite}
        />
        <Champ
          libelle="Adresse de l'avis"
          type="url"
          maxLength={500}
          value={s.url}
          onChange={(e) => maj({ url: e.target.value })}
          erreur={f.erreurs.url}
        />
      </div>
      <ZoneTexte
        libelle="Objet"
        maxLength={4000}
        value={s.objet}
        onChange={(e) => maj({ objet: e.target.value })}
        erreur={f.erreurs.objet}
      />
      <Champ
        libelle="Mots-clés"
        value={s.mots_cles}
        onChange={(e) => maj({ mots_cles: e.target.value })}
        aide="Séparés par des virgules : ils servent au rapprochement avec les compétences du cabinet."
      />
      <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
        Enregistrer la fiche
      </Bouton>
    </form>
  );
}

/**
 * Import manuel d'un lot de fiches (AO-01) depuis un CSV collé : en-tête obligatoire, colonnes
 * reference, titre, bailleur, pays, secteur, montant, devise, date_limite, url, mots_cles (séparés
 * par « | »). Les références déjà connues sont ignorées par l'API et signalées.
 */
export function ImportCsvAo() {
  const router = useRouter();
  const [texte, setTexte] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const analyse = texte.trim() === "" ? null : analyserImportCsv(texte);
  return (
    <div className="mp-pile">
      <ZoneTexte
        libelle="Fiches au format CSV"
        rows={6}
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        aide="Première ligne : titre;reference;bailleur;pays;secteur;montant;devise;date_limite;url;mots_cles"
      />
      {analyse ? (
        <p className="mp-texte-doux mp-texte-petit" role="status">
          {analyse.fiches.length} fiche(s) lisible(s)
          {analyse.erreurs.length > 0
            ? ` ; lignes refusées : ${analyse.erreurs.map((e) => `${e.ligne} (${e.message})`).join(", ")}`
            : ""}
        </p>
      ) : null}
      {erreur ? (
        <Alerte tonalite="danger">
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {message ? (
        <Alerte tonalite="succes">
          <p>{message}</p>
        </Alerte>
      ) : null}
      <Bouton
        variante="secondaire"
        chargement={enCours}
        texteChargement="Import…"
        disabled={!analyse || analyse.fiches.length === 0}
        onClick={async () => {
          if (!analyse) return;
          setEnCours(true);
          setErreur(null);
          try {
            const r = await api.post<{ crees: string[]; ignores: { reference: string }[] }>(
              "/api/appels-offres/import",
              { fiches: analyse.fiches, source_libelle: "Import CSV" },
            );
            setMessage(
              `${r.crees.length} fiche(s) créée(s)` +
                (r.ignores.length > 0
                  ? ` ; déjà connues : ${r.ignores.map((i) => i.reference).join(", ")}`
                  : "."),
            );
            setTexte("");
            router.refresh();
          } catch (e) {
            setErreur(messageAo(e));
          } finally {
            setEnCours(false);
          }
        }}
      >
        Importer les fiches
      </Bouton>
    </div>
  );
}
