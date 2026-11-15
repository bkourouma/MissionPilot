"use client";

import { useRouter } from "next/navigation";
import { useRafraichir } from "../formulaires/useRafraichir";
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
import { useLangue, useT } from "../i18n/FournisseurLangue";
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
  const t = useT();
  const langue = useLangue();
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
        await f.envoyer(
          validerFiche(s, langue),
          (c) => api.post<FicheAo>("/api/appels-offres", c),
          {
            messageSpecifique: (err) => messageAo(err, langue),
            rafraichir: false,
            apres: (r) => router.push(hrefFiche(r.id)),
          },
        );
      }}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur={t("Enregistrement impossible", "Could not save")}
      />
      <Champ
        libelle={t("Intitulé", "Title")}
        required
        maxLength={300}
        value={s.titre}
        onChange={(e) => maj({ titre: e.target.value })}
        erreur={f.erreurs.titre}
      />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Référence de l'avis", "Notice reference")}
          maxLength={80}
          value={s.reference}
          onChange={(e) => maj({ reference: e.target.value })}
          erreur={f.erreurs.reference}
        />
        <Champ
          libelle={t("Bailleur", "Donor")}
          maxLength={150}
          value={s.bailleur}
          onChange={(e) => maj({ bailleur: e.target.value })}
          erreur={f.erreurs.bailleur}
        />
        <Champ
          libelle={t("Pays (code)", "Country (code)")}
          maxLength={2}
          value={s.pays}
          onChange={(e) => maj({ pays: e.target.value })}
          erreur={f.erreurs.pays}
          aide={t("Deux lettres : CI, SN, BF…", "Two letters: CI, SN, BF…")}
        />
        <Champ
          libelle={t("Secteur", "Sector")}
          maxLength={120}
          value={s.secteur}
          onChange={(e) => maj({ secteur: e.target.value })}
          erreur={f.erreurs.secteur}
        />
        <Champ
          libelle={t("Montant estimé", "Estimated amount")}
          inputMode="decimal"
          value={s.montant}
          onChange={(e) => maj({ montant: e.target.value })}
          erreur={f.erreurs.montant}
          aide={aideMontant(s.devise, langue)}
        />
        <Select
          libelle={t("Devise", "Currency")}
          value={s.devise}
          onChange={(e) => maj({ devise: e.target.value as Devise })}
          options={DEVISES.map((d) => ({ valeur: d, libelle: d }))}
        />
        <Champ
          libelle={t("Date limite de dépôt", "Submission deadline")}
          type="date"
          value={s.date_limite}
          onChange={(e) => maj({ date_limite: e.target.value })}
          erreur={f.erreurs.date_limite}
        />
        <Champ
          libelle={t("Adresse de l'avis", "Notice address")}
          type="url"
          maxLength={500}
          value={s.url}
          onChange={(e) => maj({ url: e.target.value })}
          erreur={f.erreurs.url}
        />
      </div>
      <ZoneTexte
        libelle={t("Objet", "Subject")}
        maxLength={4000}
        value={s.objet}
        onChange={(e) => maj({ objet: e.target.value })}
        erreur={f.erreurs.objet}
      />
      <Champ
        libelle={t("Mots-clés", "Keywords")}
        value={s.mots_cles}
        onChange={(e) => maj({ mots_cles: e.target.value })}
        aide={t(
          "Séparés par des virgules : ils servent au rapprochement avec les compétences du cabinet.",
          "Separated by commas: used to match against the firm's skills.",
        )}
      />
      <Bouton
        type="submit"
        chargement={f.enCours}
        texteChargement={t("Enregistrement…", "Saving…")}
      >
        {t("Enregistrer la fiche", "Save the record")}
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
  const t = useT();
  const langue = useLangue();
  const { rafraichir, enAttente } = useRafraichir();
  const [texte, setTexte] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const analyse = texte.trim() === "" ? null : analyserImportCsv(texte, langue);
  return (
    <div className="mp-pile">
      <ZoneTexte
        libelle={t("Fiches au format CSV", "Records in CSV format")}
        rows={6}
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        aide={t(
          "Première ligne : titre;reference;bailleur;pays;secteur;montant;devise;date_limite;url;mots_cles",
          "First line: titre;reference;bailleur;pays;secteur;montant;devise;date_limite;url;mots_cles",
        )}
      />
      {analyse ? (
        <p className="mp-texte-doux mp-texte-petit" role="status">
          {t(
            `${analyse.fiches.length} fiche(s) lisible(s)`,
            `${analyse.fiches.length} readable record(s)`,
          )}
          {analyse.erreurs.length > 0
            ? t(
                ` ; lignes refusées : ${analyse.erreurs.map((e) => `${e.ligne} (${e.message})`).join(", ")}`,
                `; rejected lines: ${analyse.erreurs.map((e) => `${e.ligne} (${e.message})`).join(", ")}`,
              )
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
        chargement={enCours || enAttente}
        texteChargement={t("Import…", "Importing…")}
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
              t(`${r.crees.length} fiche(s) créée(s)`, `${r.crees.length} record(s) created`) +
                (r.ignores.length > 0
                  ? t(
                      ` ; déjà connues : ${r.ignores.map((i) => i.reference).join(", ")}`,
                      `; already known: ${r.ignores.map((i) => i.reference).join(", ")}`,
                    )
                  : "."),
            );
            setTexte("");
            rafraichir();
          } catch (e) {
            setErreur(messageAo(e, langue));
          } finally {
            setEnCours(false);
          }
        }}
      >
        {t("Importer les fiches", "Import the records")}
      </Bouton>
    </div>
  );
}
