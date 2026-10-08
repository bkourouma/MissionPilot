"use client";

import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../../components/ui/Bouton";
import { Champ } from "../../../../../components/ui/Champ";
import { EtatVide } from "../../../../../components/ui/EtatListe";
import { Select, type OptionSelect } from "../../../../../components/ui/Select";
import { api } from "../../../../../lib/api";
import { OPTIONS_DEVISES } from "../../../../../lib/cabinet";
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

function validite(t: Pick<TauxClient, "valide_du" | "valide_au">): string {
  if (!t.valide_du && !t.valide_au) return "Sans limite de validité";
  if (t.valide_du && t.valide_au)
    return `Du ${formaterDate(t.valide_du)} au ${formaterDate(t.valide_au)}`;
  return t.valide_du
    ? `À partir du ${formaterDate(t.valide_du)}`
    : `Jusqu'au ${formaterDate(t.valide_au)}`;
}

export function TauxNegocies({ clientId, clientActif, taux, grades }: TauxNegociesProps) {
  const [ajout, setAjout] = useState(false);
  return (
    <section className="mp-pile" aria-labelledby="titre-taux">
      <h2 id="titre-taux" className="mp-section__titre">
        Taux par grade
      </h2>
      {taux.length === 0 ? (
        <EtatVide titre="Aucun taux négocié pour ce client." icone="facture">
          <p>Sans taux négocié, le taux standard du grade s&apos;applique.</p>
        </EtatVide>
      ) : (
        <ul className="mp-liste-lignes">
          {taux.map((t) => (
            <LigneTaux key={t.id} taux={t} />
          ))}
        </ul>
      )}
      {!clientActif ? (
        <p className="mp-texte-doux">Client archivé : aucun nouveau taux.</p>
      ) : ajout ? (
        <FormulaireTaux
          titre="Nouveau taux négocié"
          initial={saisieTauxVide("XOF")}
          grades={grades}
          creation
          onFin={() => setAjout(false)}
          envoyer={(s) => validerTaux(s)}
          appel={(c) => api.post(`/api/clients/${encodeURIComponent(clientId)}/taux`, c)}
        />
      ) : grades.length === 0 ? (
        <p className="mp-texte-doux">
          Aucun grade actif : créez d&apos;abord les grades du catalogue.
        </p>
      ) : (
        <div>
          <Bouton variante="secondaire" icone="plus" onClick={() => setAjout(true)}>
            Ajouter un taux
          </Bouton>
        </div>
      )}
    </section>
  );
}

function LigneTaux({ taux }: { taux: TauxClient }) {
  const [edition, setEdition] = useState(false);
  return (
    <li className="mp-liste-lignes__ligne">
      <span className="mp-liste-lignes__texte">
        <strong>{taux.grade_libelle}</strong>
        <span className="mp-texte-doux">{validite(taux)}</span>
      </span>
      <span className="mp-montant">{`${formaterMontantMineur(taux.taux, taux.devise)} / jour`}</span>
      {edition ? (
        <FormulaireTaux
          titre={`Modifier le taux ${taux.grade_libelle}`}
          initial={saisieDepuisTaux(taux)}
          grades={[{ valeur: taux.grade_id, libelle: taux.grade_libelle }]}
          creation={false}
          onFin={() => setEdition(false)}
          envoyer={(s) => validerModificationTaux(s, taux.devise)}
          appel={(c) => api.patch(`/api/taux-clients/${encodeURIComponent(taux.id)}`, c)}
        />
      ) : (
        <Bouton
          variante="discret"
          icone="crayon"
          onClick={() => setEdition(true)}
          aria-label={`Modifier le taux ${taux.grade_libelle}`}
        >
          Modifier
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
          libelle="Grade"
          options={grades}
          invite={creation ? "Choisir un grade…" : undefined}
          required
          disabled={!creation}
          value={s.grade_id}
          onChange={(e) => maj("grade_id")(e.target.value)}
          erreur={f.erreurs.grade_id}
        />
        <Select
          libelle="Devise"
          options={OPTIONS_DEVISES}
          required
          disabled={!creation}
          value={s.devise}
          onChange={(e) => maj("devise")(e.target.value)}
          erreur={f.erreurs.devise}
        />
        <Champ
          libelle="Taux journalier"
          aide={aideMontant(s.devise as Devise)}
          required
          inputMode="decimal"
          value={s.taux}
          onChange={(e) => maj("taux")(e.target.value)}
          erreur={f.erreurs.taux}
        />
        <Champ
          libelle="Valide à partir du"
          type="date"
          value={s.valide_du}
          onChange={(e) => maj("valide_du")(e.target.value)}
          erreur={f.erreurs.valide_du}
        />
        <Champ
          libelle="Valide jusqu'au"
          type="date"
          value={s.valide_au}
          onChange={(e) => maj("valide_au")(e.target.value)}
          erreur={f.erreurs.valide_au}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Enregistrer
        </Bouton>
        <Bouton variante="discret" onClick={onFin}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}
