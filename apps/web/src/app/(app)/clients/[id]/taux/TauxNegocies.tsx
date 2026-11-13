"use client";

import { useState, type FormEvent } from "react";
import type { Langue, Traduire } from "@missionpilot/shared";
import { useLangue, useT } from "../../../../../components/i18n/FournisseurLangue";
import { RetourFormulaire } from "../../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../../components/ui/Bouton";
import { Champ } from "../../../../../components/ui/Champ";
import { EtatVide } from "../../../../../components/ui/EtatListe";
import { Select, type OptionSelect } from "../../../../../components/ui/Select";
import { api } from "../../../../../lib/api";
import { optionsDevises } from "../../../../../lib/cabinet";
import { formaterDate, formaterMontantMineur, type Devise } from "../../../../../lib/format";
import { aideMontant } from "../../../../../lib/saisie";
import {
  saisieDepuisTaux,
  saisieTauxVide,
  validerModificationTaux,
  validerTaux,
  type ChampTaux,
  type SaisieTaux,
  type TauxClient,
} from "../../../../../lib/taux-clients";

export interface TauxNegociesProps {
  clientId: string;
  clientActif: boolean;
  taux: TauxClient[];
  grades: OptionSelect[];
}

function validite(
  x: Pick<TauxClient, "valide_du" | "valide_au">,
  t: Traduire,
  langue: Langue,
): string {
  const d = (v: string | null) => formaterDate(v, "UTC", langue);
  if (!x.valide_du && !x.valide_au) return t("Sans limite de validité", "No validity limit");
  if (x.valide_du && x.valide_au)
    return t(
      `Du ${d(x.valide_du)} au ${d(x.valide_au)}`,
      `From ${d(x.valide_du)} to ${d(x.valide_au)}`,
    );
  return x.valide_du
    ? t(`À partir du ${d(x.valide_du)}`, `From ${d(x.valide_du)}`)
    : t(`Jusqu'au ${d(x.valide_au)}`, `Until ${d(x.valide_au)}`);
}

export function TauxNegocies({ clientId, clientActif, taux, grades }: TauxNegociesProps) {
  const t = useT();
  const langue = useLangue();
  const [ajout, setAjout] = useState(false);
  return (
    <section className="mp-pile" aria-labelledby="titre-taux">
      <h2 id="titre-taux" className="mp-section__titre">
        {t("Taux par grade", "Rates by grade")}
      </h2>
      {taux.length === 0 ? (
        <EtatVide
          titre={t("Aucun taux négocié pour ce client.", "No negotiated rate for this client.")}
          icone="facture"
        >
          <p>
            {t(
              "Sans taux négocié, le taux standard du grade s'applique.",
              "Without a negotiated rate, the standard grade rate applies.",
            )}
          </p>
        </EtatVide>
      ) : (
        <ul className="mp-liste-lignes">
          {taux.map((t) => (
            <LigneTaux key={t.id} taux={t} />
          ))}
        </ul>
      )}
      {!clientActif ? (
        <p className="mp-texte-doux">
          {t("Client archivé : aucun nouveau taux.", "Archived client: no new rates.")}
        </p>
      ) : ajout ? (
        <FormulaireTaux
          titre={t("Nouveau taux négocié", "New negotiated rate")}
          initial={saisieTauxVide("XOF")}
          grades={grades}
          creation
          onFin={() => setAjout(false)}
          envoyer={(s) => validerTaux(s, langue)}
          appel={(c) => api.post(`/api/clients/${encodeURIComponent(clientId)}/taux`, c)}
        />
      ) : grades.length === 0 ? (
        <p className="mp-texte-doux">
          {t(
            "Aucun grade actif : créez d'abord les grades du catalogue.",
            "No active grade: create the catalog grades first.",
          )}
        </p>
      ) : (
        <div>
          <Bouton variante="secondaire" icone="plus" onClick={() => setAjout(true)}>
            {t("Ajouter un taux", "Add a rate")}
          </Bouton>
        </div>
      )}
    </section>
  );
}

function LigneTaux({ taux }: { taux: TauxClient }) {
  const t = useT();
  const langue = useLangue();
  const [edition, setEdition] = useState(false);
  return (
    <li className="mp-liste-lignes__ligne">
      <span className="mp-liste-lignes__texte">
        <strong>{taux.grade_libelle}</strong>
        <span className="mp-texte-doux">{validite(taux, t, langue)}</span>
      </span>
      <span className="mp-montant">{`${formaterMontantMineur(taux.taux, taux.devise, langue)} ${t("/ jour", "/ day")}`}</span>
      {edition ? (
        <FormulaireTaux
          titre={t(`Modifier le taux ${taux.grade_libelle}`, `Edit rate ${taux.grade_libelle}`)}
          initial={saisieDepuisTaux(taux)}
          grades={[{ valeur: taux.grade_id, libelle: taux.grade_libelle }]}
          creation={false}
          onFin={() => setEdition(false)}
          envoyer={(s) => validerModificationTaux(s, taux.devise, langue)}
          appel={(c) => api.patch(`/api/taux-clients/${encodeURIComponent(taux.id)}`, c)}
        />
      ) : (
        <Bouton
          variante="discret"
          icone="crayon"
          onClick={() => setEdition(true)}
          aria-label={t(
            `Modifier le taux ${taux.grade_libelle}`,
            `Edit rate ${taux.grade_libelle}`,
          )}
        >
          {t("Modifier", "Edit")}
        </Bouton>
      )}
    </li>
  );
}

function FormulaireTaux({
  titre,
  initial,
  grades,
  creation,
  onFin,
  envoyer,
  appel,
}: {
  titre: string;
  initial: SaisieTaux;
  grades: readonly OptionSelect[];
  creation: boolean;
  onFin: () => void;
  envoyer: (
    s: SaisieTaux,
  ) => ReturnType<typeof validerTaux> | ReturnType<typeof validerModificationTaux>;
  appel: (c: unknown) => Promise<unknown>;
}) {
  const t = useT();
  const langue = useLangue();
  const [s, setS] = useState<SaisieTaux>(initial);
  const f = useFormulaire<ChampTaux>();
  const maj = (champ: keyof SaisieTaux) => (v: string) => setS((x) => ({ ...x, [champ]: v }));
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer<unknown, unknown>(envoyer(s), appel, { apres: onFin });
  }
  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire mp-pleine-largeur"
      noValidate
      onSubmit={soumettre}
      aria-label={titre}
    >
      <p className="mp-sous-formulaire__titre">{titre}</p>
      <RetourFormulaire erreur={f.erreurGlobale} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Select
          libelle={t("Grade", "Grade")}
          options={grades}
          invite={creation ? t("Choisir un grade…", "Choose a grade…") : undefined}
          required
          disabled={!creation}
          value={s.grade_id}
          onChange={(e) => maj("grade_id")(e.target.value)}
          erreur={f.erreurs.grade_id}
        />
        <Select
          libelle={t("Devise", "Currency")}
          options={optionsDevises(langue)}
          required
          disabled={!creation}
          value={s.devise}
          onChange={(e) => maj("devise")(e.target.value)}
          erreur={f.erreurs.devise}
        />
        <Champ
          libelle={t("Taux journalier", "Daily rate")}
          aide={aideMontant(s.devise as Devise, langue)}
          required
          inputMode="decimal"
          value={s.taux}
          onChange={(e) => maj("taux")(e.target.value)}
          erreur={f.erreurs.taux}
        />
        <Champ
          libelle={t("Valide à partir du", "Valid from")}
          type="date"
          value={s.valide_du}
          onChange={(e) => maj("valide_du")(e.target.value)}
          erreur={f.erreurs.valide_du}
        />
        <Champ
          libelle={t("Valide jusqu'au", "Valid until")}
          type="date"
          value={s.valide_au}
          onChange={(e) => maj("valide_au")(e.target.value)}
          erreur={f.erreurs.valide_au}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer", "Save")}
        </Bouton>
        <Bouton variante="discret" onClick={onFin}>
          {t("Annuler", "Cancel")}
        </Bouton>
      </div>
    </form>
  );
}
